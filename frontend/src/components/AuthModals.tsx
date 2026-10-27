import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Cpu,
  Fingerprint,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Server,
  Shield,
  Trash2,
  User,
  UserCog,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { api } from "../api";
import {
  AppSettings,
  AuthSessionResponse,
  AuthStatusResponse,
  OllamaStatusResponse,
  PasskeyInfo,
  ProfileModelSettingsResponse,
  UserModelSettingsPayload,
  UserProfile,
} from "../types";

// ------------------------------------------------------------------
// Feedback Dialog (Success / Error confirmation prompt)
// ------------------------------------------------------------------

interface FeedbackModalProps {
  type: "success" | "error";
  title: string;
  message: string;
  onConfirm: () => void;
  confirmLabel?: string;
}

export const FeedbackModal: React.FC<FeedbackModalProps> = ({
  type,
  title,
  message,
  onConfirm,
  confirmLabel = "OK",
}) => {
  return (
    <div className="modal-backdrop" style={{ zIndex: 1200 }}>
      <div className="modal-panel" style={{ maxWidth: 460, padding: 0 }}>
        <div
          className="modal-header"
          style={{
            borderColor:
              type === "error"
                ? "rgba(244, 63, 94, 0.4)"
                : "rgba(16, 185, 129, 0.4)",
          }}
        >
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color:
                type === "error" ? "#fda4af" : "var(--accent-emerald)",
            }}
          >
            {type === "error" ? (
              <AlertTriangle size={18} />
            ) : (
              <Check size={18} />
            )}
            {title}
          </span>
        </div>
        <div
          className="modal-body"
          style={{
            padding: "20px",
            fontSize: "0.88rem",
            lineHeight: 1.55,
            color: "var(--text-secondary)",
          }}
        >
          {message}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: "12px 20px",
            borderTop: "1px solid var(--border-subtle)",
            background: "var(--bg-deep)",
          }}
        >
          <button
            type="button"
            className={`btn ${type === "error" ? "btn-danger" : "btn-amber"}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------
// 1. First-Time Initial Setup Screen
// ------------------------------------------------------------------

interface InitialSetupScreenProps {
  onComplete: (res: AuthSessionResponse) => void;
}

export const InitialSetupScreen: React.FC<InitialSetupScreenProps> = ({
  onComplete,
}) => {
  const [username, setUsername] = useState("admin");
  const [displayName, setDisplayName] = useState("Administrator");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showBlankWarning, setShowBlankWarning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (
    e: React.FormEvent,
    confirmBlank: boolean = false
  ) => {
    e.preventDefault();
    setError(null);

    if (!username.trim()) {
      setError("Please enter an administrator username.");
      return;
    }

    if (password && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!password && !confirmBlank) {
      setShowBlankWarning(true);
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.initialSetup({
        username: username.trim(),
        display_name: displayName.trim() || username.trim(),
        password,
        confirm_blank_password: confirmBlank,
      });
      onComplete(res);
    } catch (err: any) {
      setError(err?.message || "Failed to initialize administrator account.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-stage-backdrop">
      <div className="modal-panel" style={{ maxWidth: 480, width: "100%" }}>
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Shield size={18} color="var(--accent-amber)" />
            Welcome to CyberCantina — Initial Admin Setup
          </span>
        </div>

        <form
          className="modal-body"
          onSubmit={(e) => handleSubmit(e, false)}
          style={{ gap: 14 }}
        >
          <p
            style={{
              fontSize: "0.82rem",
              color: "var(--text-secondary)",
              lineHeight: 1.5,
            }}
          >
            Configure the primary administrator account for this CyberCantina
            instance. For local single-user setups, you may leave the password
            blank.
          </p>

          {error && (
            <div className="auth-alert auth-alert-error">
              <AlertTriangle size={15} />
              <span>{error}</span>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Admin Username</label>
            <input
              type="text"
              className="form-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              autoFocus
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Display Name</label>
            <input
              type="text"
              className="form-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Administrator"
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              Admin Password{" "}
              <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                (Leave blank for local single-user mode)
              </span>
            </label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (e.target.value) setShowBlankWarning(false);
              }}
              placeholder="Enter a strong password or leave blank..."
            />
          </div>

          {password && (
            <div className="form-group">
              <label className="form-label">Confirm Password</label>
              <input
                type="password"
                className="form-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password..."
              />
            </div>
          )}

          {showBlankWarning && !password && (
            <div className="auth-warning-box">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontWeight: 700,
                  color: "var(--accent-amber)",
                  marginBottom: 6,
                }}
              >
                <AlertTriangle size={16} />
                <span>Disable Multi-User Support?</span>
              </div>
              <p
                style={{
                  fontSize: "0.78rem",
                  color: "var(--text-secondary)",
                  lineHeight: 1.45,
                  marginBottom: 10,
                }}
              >
                Leaving the admin user&apos;s password blank will{" "}
                <strong>disable multi-user support</strong> and automatically log
                you into this account on subsequent accesses. You can set a
                password later in your Profile to enable multi-user mode.
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
                  onClick={() => setShowBlankWarning(false)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-amber"
                  onClick={(e) => handleSubmit(e, true)}
                  disabled={submitting}
                >
                  {submitting
                    ? "Initializing..."
                    : "Confirm Blank Password (Single-User)"}
                </button>
              </div>
            </div>
          )}

          {!showBlankWarning && (
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: 6,
              }}
            >
              <button
                type="submit"
                className="btn btn-amber"
                disabled={submitting}
              >
                {submitting
                  ? "Saving..."
                  : password
                  ? "Create Admin Account (Multi-User)"
                  : "Continue with Blank Password"}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------
// 2. Authentication Screen (Login with Password / Passkey & Register)
// ------------------------------------------------------------------

interface AuthScreenProps {
  singleUserMode: boolean;
  onAuthenticated: (res: AuthSessionResponse) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  singleUserMode,
  onAuthenticated,
}) => {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim()) {
      setError("Username is required.");
      return;
    }

    if (mode === "register") {
      if (!password) {
        setError("Password is required.");
        return;
      }
      if (password !== confirmPassword) {
        setError("Passwords do not match.");
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === "login") {
        const res = await api.login({
          username: username.trim(),
          password,
        });
        onAuthenticated(res);
      } else {
        const res = await api.register({
          username: username.trim(),
          display_name: displayName.trim() || username.trim(),
          password,
        });
        onAuthenticated(res);
      }
    } catch (err: any) {
      setError(err?.message || "Authentication failed.");
    } finally {
      setBusy(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await api.loginWithPasskey(username.trim() || undefined);
      onAuthenticated(res);
    } catch (err: any) {
      setError(err?.message || "Passkey sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-stage-backdrop">
      <div className="modal-panel" style={{ maxWidth: 440, width: "100%" }}>
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Lock size={18} color="var(--accent-amber)" />
            {mode === "login"
              ? "Sign In to CyberCantina"
              : "Create CyberCantina Account"}
          </span>
        </div>

        <div className="modal-body" style={{ gap: 14 }}>
          {!singleUserMode && (
            <div className="Inspector-tabs" style={{ marginBottom: 4 }}>
              <button
                type="button"
                className={`tab-btn ${mode === "login" ? "active" : ""}`}
                onClick={() => {
                  setMode("login");
                  setError(null);
                }}
              >
                Sign In
              </button>
              <button
                type="button"
                className={`tab-btn ${mode === "register" ? "active" : ""}`}
                onClick={() => {
                  setMode("register");
                  setError(null);
                }}
              >
                Create Account
              </button>
            </div>
          )}

          {error && (
            <div className="auth-alert auth-alert-error">
              <AlertTriangle size={15} />
              <span>{error}</span>
            </div>
          )}

          <form
            onSubmit={handlePasswordSubmit}
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                type="text"
                className="form-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username..."
                autoFocus
                required
              />
            </div>

            {mode === "register" && (
              <div className="form-group">
                <label className="form-label">Display Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="How your name appears in the studio..."
                />
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password..."
              />
            </div>

            {mode === "register" && (
              <div className="form-group">
                <label className="form-label">Confirm Password</label>
                <input
                  type="password"
                  className="form-input"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm password..."
                />
              </div>
            )}

            <button
              type="submit"
              className="btn btn-amber"
              style={{ width: "100%", marginTop: 4 }}
              disabled={busy}
            >
              <KeyRound size={15} />
              <span>
                {busy
                  ? "Authenticating..."
                  : mode === "login"
                  ? "Sign In with Password"
                  : "Create Account"}
              </span>
            </button>
          </form>

          {mode === "login" && (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  margin: "2px 0",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    height: 1,
                    background: "var(--border-subtle)",
                  }}
                />
                <span
                  style={{
                    fontSize: "0.7rem",
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                  }}
                >
                  or
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 1,
                    background: "var(--border-subtle)",
                  }}
                />
              </div>

              <button
                type="button"
                className="btn btn-cyan"
                style={{ width: "100%" }}
                onClick={handlePasskeyLogin}
                disabled={busy}
              >
                <Fingerprint size={16} />
                <span>Sign In with Passkey</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------
// 3. User Profile Modal (Name, Read-Only Username, Password, Passkeys)
// ------------------------------------------------------------------

interface ProfileModalProps {
  user: UserProfile;
  singleUserMode: boolean;
  initialTab?: "identity" | "account" | "models";
  onClose: () => void;
  onUserUpdated: (updated: UserProfile, singleUserMode?: boolean) => void;
  onAccountReset: () => Promise<void>;
  onAccountDeleted: () => Promise<void>;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  user,
  singleUserMode,
  initialTab,
  onClose,
  onUserUpdated,
  onAccountReset,
  onAccountDeleted,
}) => {
  const [activeTab, setActiveTab] = useState<"identity" | "account" | "models">(
    initialTab ?? "identity"
  );
  const [displayName, setDisplayName] = useState(user.display_name);
  const [savingName, setSavingName] = useState(false);

  // Per-User Model Overrides state
  const [modelSettings, setModelSettings] =
    useState<ProfileModelSettingsResponse | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelSaving, setModelSaving] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatusResponse | null>(
    null
  );
  const [probingOllama, setProbingOllama] = useState(false);

  const [userActorModel, setUserActorModel] = useState("");
  const [userActorTemp, setUserActorTemp] = useState(0.75);
  const [userActorTokens, setUserActorTokens] = useState(1024);

  const [userClerkModel, setUserClerkModel] = useState("");
  const [userClerkTemp, setUserClerkTemp] = useState(0.2);
  const [userClerkTokens, setUserClerkTokens] = useState(768);

  const [userWmTurns, setUserWmTurns] = useState<number>(10);

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

  const probeOllama = async (urlToProbe?: string) => {
    setProbingOllama(true);
    try {
      const ost = await api.getOllamaStatus(urlToProbe);
      setOllamaStatus(ost);
    } catch {
      // ignore
    } finally {
      setProbingOllama(false);
    }
  };

  const loadProfileModels = async () => {
    setModelLoading(true);
    try {
      const data = await api.getProfileModels();
      setModelSettings(data);
      const activeActor = data.user_actor_profile ?? data.default_actor_profile;
      const activeClerk = data.user_clerk_profile ?? data.default_clerk_profile;

      setUserActorModel(activeActor.model);
      setUserActorTemp(activeActor.temperature);
      setUserActorTokens(activeActor.max_tokens);

      setUserClerkModel(activeClerk.model);
      setUserClerkTemp(activeClerk.temperature);
      setUserClerkTokens(activeClerk.max_tokens);

      setUserWmTurns(
        data.user_working_memory_turns ?? data.default_working_memory_turns
      );

      probeOllama(activeActor.base_url);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to load profile models.");
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
          model: userActorModel,
          temperature: userActorTemp,
          max_tokens: userActorTokens,
        },
        clerk_profile: {
          ...modelSettings.effective_clerk_profile,
          model: userClerkModel,
          temperature: userClerkTemp,
          max_tokens: userClerkTokens,
        },
        working_memory_turns: userWmTurns,
      };
      const res = await api.updateProfileModels(payload);
      setModelSettings(res);
      setStatusMsg("Per-user model overrides saved successfully.");
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to save model overrides.");
    } finally {
      setModelSaving(false);
    }
  };

  const handleResetModelOverrides = async () => {
    setModelSaving(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const res = await api.resetProfileModels();
      setModelSettings(res);
      setUserActorModel(res.default_actor_profile.model);
      setUserActorTemp(res.default_actor_profile.temperature);
      setUserActorTokens(res.default_actor_profile.max_tokens);
      setUserClerkModel(res.default_clerk_profile.model);
      setUserClerkTemp(res.default_clerk_profile.temperature);
      setUserClerkTokens(res.default_clerk_profile.max_tokens);
      setUserWmTurns(res.default_working_memory_turns);
      setStatusMsg("Reverted to system default models.");
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to reset model overrides.");
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

  return (
    <div className="modal-backdrop">
      <div className="modal-panel" style={{ maxWidth: 600 }}>
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <User size={18} color="var(--accent-amber)" />
            User Profile &amp; Security Credentials
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
              activeTab === "models" ? "active" : ""
            }`}
            onClick={() => setActiveTab("models")}
          >
            <Cpu size={14} />
            Models
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

          {/* 3. Per-User Model Overrides */}
          {activeTab === "models" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {modelLoading && (
                <div
                  style={{
                    padding: "24px 0",
                    textAlign: "center",
                    color: "var(--text-secondary)",
                    fontSize: "0.85rem",
                  }}
                >
                  Loading model configuration...
                </div>
              )}

              {!modelLoading &&
                modelSettings &&
                !modelSettings.allow_user_model_overrides && (
                  <div
                    style={{
                      background: "rgba(255, 255, 255, 0.03)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 8,
                      padding: 18,
                      display: "flex",
                      flexDirection: "column",
                      gap: 14,
                      opacity: 0.9,
                    }}
                  >
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
                        <strong>Per-User Model Overrides Disabled:</strong> The
                        system administrator has configured global default
                        models for all roleplay sessions. Custom model overrides
                        are currently locked.
                      </span>
                    </div>

                    <div
                      style={{
                        fontSize: "0.78rem",
                        color: "var(--text-secondary)",
                      }}
                    >
                      System default models currently active for your session:
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          padding: 12,
                          borderRadius: 6,
                          background: "var(--bg-deep)",
                          border: "1px solid var(--border-subtle)",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "0.72rem",
                            color: "var(--accent-amber)",
                            fontWeight: 600,
                            marginBottom: 4,
                          }}
                        >
                          Primary Actor Model
                        </div>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: "0.86rem",
                            color: "var(--text-primary)",
                          }}
                        >
                          {modelSettings.default_actor_profile.model}
                        </div>
                        <div
                          style={{
                            fontSize: "0.72rem",
                            color: "var(--text-muted)",
                            marginTop: 4,
                          }}
                        >
                          Temp:{" "}
                          {modelSettings.default_actor_profile.temperature} • Max
                          Tokens:{" "}
                          {modelSettings.default_actor_profile.max_tokens}
                        </div>
                      </div>

                      <div
                        style={{
                          padding: 12,
                          borderRadius: 6,
                          background: "var(--bg-deep)",
                          border: "1px solid var(--border-subtle)",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "0.72rem",
                            color: "var(--accent-cyan)",
                            fontWeight: 600,
                            marginBottom: 4,
                          }}
                        >
                          Auxiliary Clerk Model
                        </div>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: "0.86rem",
                            color: "var(--text-primary)",
                          }}
                        >
                          {modelSettings.default_clerk_profile.model}
                        </div>
                        <div
                          style={{
                            fontSize: "0.72rem",
                            color: "var(--text-muted)",
                            marginTop: 4,
                          }}
                        >
                          Temp:{" "}
                          {modelSettings.default_clerk_profile.temperature} • Max
                          Tokens:{" "}
                          {modelSettings.default_clerk_profile.max_tokens}
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        fontSize: "0.74rem",
                        color: "var(--text-muted)",
                      }}
                    >
                      Working Memory Window:{" "}
                      {modelSettings.default_working_memory_turns} turns
                    </div>
                  </div>
                )}

              {!modelLoading &&
                modelSettings &&
                modelSettings.allow_user_model_overrides && (
                  <form
                    onSubmit={handleSaveModelOverrides}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 14,
                    }}
                  >
                    {/* Live Ollama Discovery Banner */}
                    <div
                      style={{
                        background: ollamaStatus?.reachable
                          ? "rgba(16, 185, 129, 0.1)"
                          : "rgba(244, 63, 94, 0.1)",
                        border: `1px solid ${
                          ollamaStatus?.reachable
                            ? "rgba(16, 185, 129, 0.4)"
                            : "rgba(244, 63, 94, 0.4)"
                        }`,
                        borderRadius: 8,
                        padding: "10px 14px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <Server
                          size={18}
                          color={
                            ollamaStatus?.reachable
                              ? "var(--accent-emerald)"
                              : "var(--accent-rose)"
                          }
                        />
                        <div style={{ fontSize: "0.8rem" }}>
                          {ollamaStatus?.reachable ? (
                            <>
                              <strong style={{ color: "#6ee7b7" }}>
                                Ollama Connected ({ollamaStatus.ollama_root_url}
                                )
                              </strong>
                              <div
                                style={{
                                  color: "var(--text-secondary)",
                                  fontSize: "0.74rem",
                                }}
                              >
                                {ollamaStatus.chat_models.length} model(s)
                                available for override
                              </div>
                            </>
                          ) : (
                            <>
                              <strong style={{ color: "#fda4af" }}>
                                Ollama Server (
                                {ollamaStatus?.ollama_root_url ??
                                  modelSettings.effective_actor_profile.base_url}
                                )
                              </strong>
                              <div
                                style={{
                                  color: "var(--text-secondary)",
                                  fontSize: "0.74rem",
                                }}
                              >
                                {ollamaStatus?.error ||
                                  "Offline simulation fallback active"}
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        className="btn"
                        onClick={() =>
                          probeOllama(
                            modelSettings.effective_actor_profile.base_url
                          )
                        }
                        disabled={probingOllama}
                      >
                        <RefreshCw size={13} />
                        {probingOllama ? "Probing..." : "Refresh"}
                      </button>
                    </div>

                    {/* Actor Model Override */}
                    <div
                      style={{
                        background: "var(--bg-card)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: 8,
                        padding: 14,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
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
                            fontWeight: 600,
                            fontSize: "0.84rem",
                            color: "var(--accent-amber)",
                          }}
                        >
                          1. Primary Actor Model Override
                        </span>
                        <span
                          style={{
                            fontSize: "0.7rem",
                            color: "var(--text-muted)",
                          }}
                        >
                          System Default:{" "}
                          {modelSettings.default_actor_profile.model}
                        </span>
                      </div>

                      <div className="form-group">
                        <label className="form-label">Actor Model</label>
                        {ollamaStatus?.chat_models &&
                        ollamaStatus.chat_models.length > 0 ? (
                          <select
                            className="form-input"
                            value={userActorModel}
                            onChange={(e) => setUserActorModel(e.target.value)}
                          >
                            {ollamaStatus.chat_models.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            className="form-input"
                            value={userActorModel}
                            onChange={(e) => setUserActorModel(e.target.value)}
                            placeholder="e.g. llama3.2:latest"
                          />
                        )}
                      </div>

                      <div className="grid-2">
                        <div className="form-group">
                          <label className="form-label">
                            Temperature ({userActorTemp})
                          </label>
                          <input
                            type="range"
                            min="0.0"
                            max="2.0"
                            step="0.05"
                            value={userActorTemp}
                            onChange={(e) =>
                              setUserActorTemp(parseFloat(e.target.value))
                            }
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Max Tokens</label>
                          <input
                            type="number"
                            min={64}
                            max={8192}
                            className="form-input"
                            value={userActorTokens}
                            onChange={(e) =>
                              setUserActorTokens(parseInt(e.target.value, 10))
                            }
                          />
                        </div>
                      </div>
                    </div>

                    {/* Clerk Model Override */}
                    <div
                      style={{
                        background: "var(--bg-card)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: 8,
                        padding: 14,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
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
                            fontWeight: 600,
                            fontSize: "0.84rem",
                            color: "var(--accent-cyan)",
                          }}
                        >
                          2. Auxiliary Clerk Model Override
                        </span>
                        <span
                          style={{
                            fontSize: "0.7rem",
                            color: "var(--text-muted)",
                          }}
                        >
                          System Default:{" "}
                          {modelSettings.default_clerk_profile.model}
                        </span>
                      </div>

                      <div className="form-group">
                        <label className="form-label">Clerk Model</label>
                        {ollamaStatus?.chat_models &&
                        ollamaStatus.chat_models.length > 0 ? (
                          <select
                            className="form-input"
                            value={userClerkModel}
                            onChange={(e) => setUserClerkModel(e.target.value)}
                          >
                            {ollamaStatus.chat_models.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            className="form-input"
                            value={userClerkModel}
                            onChange={(e) => setUserClerkModel(e.target.value)}
                            placeholder="e.g. llama3.1:8b"
                          />
                        )}
                      </div>

                      <div className="grid-2">
                        <div className="form-group">
                          <label className="form-label">
                            Temperature ({userClerkTemp})
                          </label>
                          <input
                            type="range"
                            min="0.0"
                            max="2.0"
                            step="0.05"
                            value={userClerkTemp}
                            onChange={(e) =>
                              setUserClerkTemp(parseFloat(e.target.value))
                            }
                          />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Max Tokens</label>
                          <input
                            type="number"
                            min={64}
                            max={8192}
                            className="form-input"
                            value={userClerkTokens}
                            onChange={(e) =>
                              setUserClerkTokens(parseInt(e.target.value, 10))
                            }
                          />
                        </div>
                      </div>
                    </div>

                    {/* Working Memory Window */}
                    <div
                      style={{
                        background: "var(--bg-card)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: 8,
                        padding: 14,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <label className="form-label">
                        Zone 3 Working Memory Turns (N)
                      </label>
                      <input
                        type="number"
                        min={4}
                        max={64}
                        className="form-input"
                        value={userWmTurns}
                        onChange={(e) =>
                          setUserWmTurns(parseInt(e.target.value, 10))
                        }
                      />
                      <span
                        style={{
                          fontSize: "0.72rem",
                          color: "var(--text-muted)",
                        }}
                      >
                        Number of verbatim recent turns in active context before
                        episodic compression (Default:{" "}
                        {modelSettings.default_working_memory_turns}).
                      </span>
                    </div>

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
                          {modelSaving
                            ? "Saving..."
                            : "Save My Model Overrides"}
                        </span>
                      </button>
                    </div>
                  </form>
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

// ------------------------------------------------------------------
// 4. Admin Modal (Bottom of Left Panel -> "Users" Tab)
// ------------------------------------------------------------------

interface AdminModalProps {
  currentUser: UserProfile;
  singleUserMode: boolean;
  initialTab?: "users" | "models";
  onClose: () => void;
  onCurrentUserUpdated: (updated: UserProfile) => void;
  onAccountDeleted?: (deletedUserId: string) => Promise<void>;
  onSettingsUpdated?: (updated: AppSettings) => void;
}

export const AdminModal: React.FC<AdminModalProps> = ({
  currentUser,
  singleUserMode,
  initialTab,
  onClose,
  onCurrentUserUpdated,
  onAccountDeleted,
  onSettingsUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<"users" | "models">(
    initialTab ?? "users"
  );
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(
    currentUser.id
  );
  const [loading, setLoading] = useState(false);

  // Models tab state
  const [appSettingsForm, setAppSettingsForm] = useState<AppSettings | null>(
    null
  );
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatusResponse | null>(
    null
  );
  const [probingOllama, setProbingOllama] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const probeOllama = async (urlToProbe?: string) => {
    setProbingOllama(true);
    try {
      const ost = await api.getOllamaStatus(
        urlToProbe ?? appSettingsForm?.actor_profile.base_url
      );
      setOllamaStatus(ost);
    } catch {
      // ignore
    } finally {
      setProbingOllama(false);
    }
  };

  const loadSettings = async () => {
    try {
      const cfg = await api.getSettings();
      setAppSettingsForm(cfg);
      probeOllama(cfg.actor_profile.base_url);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to load model settings.");
    }
  };

  useEffect(() => {
    if (activeTab === "models" && !appSettingsForm) {
      loadSettings();
    }
  }, [activeTab]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appSettingsForm) return;
    setSavingSettings(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const updated = await api.updateSettings(appSettingsForm);
      setAppSettingsForm(updated);
      onSettingsUpdated?.(updated);
      setStatusMsg(
        "Global system model settings and policies saved successfully."
      );
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to save system model settings.");
    } finally {
      setSavingSettings(false);
    }
  };

  // Selected user actions
  const [editUsername, setEditUsername] = useState("");
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(
    null
  );
  const [copiedPwd, setCopiedPwd] = useState(false);
  const [showDeleteUserConfirm, setShowDeleteUserConfirm] = useState(false);
  const [deleteUserBusy, setDeleteUserBusy] = useState(false);

  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  // Optional New User creation drawer
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"user" | "admin">("user");

  const [actionBusy, setActionBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadUsers = async (preferredUserId?: string | null) => {
    setLoading(true);
    try {
      const list = await api.adminListUsers();
      setUsers(list);
      const targetId =
        preferredUserId !== undefined ? preferredUserId : selectedUserId;
      const found = list.find((u) => u.id === targetId);
      const nextUser = found ?? list[0] ?? null;
      setSelectedUserId(nextUser ? nextUser.id : null);
      if (nextUser) {
        setEditUsername(nextUser.username);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to load users.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const selectedUser =
    users.find((u) => u.id === selectedUserId) ?? users[0] ?? null;

  useEffect(() => {
    if (selectedUser) {
      setEditUsername(selectedUser.username);
      setGeneratedPassword(null);
      setCopiedPwd(false);
      setShowDeleteUserConfirm(false);
    }
  }, [selectedUser?.id]);

  const normalizedFilter = filterQuery.trim().toLowerCase();
  const filteredUsers = normalizedFilter
    ? users.filter(
        (u) =>
          u.username.toLowerCase().includes(normalizedFilter) ||
          u.display_name.toLowerCase().includes(normalizedFilter)
      )
    : users;

  const handleChangeUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setErrorMsg(null);
    setStatusMsg(null);
    setGeneratedPassword(null);

    if (!editUsername.trim()) {
      setErrorMsg("Username cannot be empty.");
      return;
    }

    setActionBusy(true);
    try {
      const updated = await api.adminChangeUsername(
        selectedUser.id,
        editUsername.trim()
      );
      setUsers((prev) =>
        prev.map((u) => (u.id === updated.id ? updated : u))
      );
      if (updated.id === currentUser.id) {
        onCurrentUserUpdated(updated);
      }
      setStatusMsg(
        `Changed username from "${selectedUser.username}" to "${updated.username}".`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to change username.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleResetPasswordRandom = async () => {
    if (!selectedUser) return;
    setErrorMsg(null);
    setStatusMsg(null);
    setCopiedPwd(false);
    setActionBusy(true);
    try {
      const res = await api.adminResetPassword(selectedUser.id);
      setUsers((prev) =>
        prev.map((u) => (u.id === res.user.id ? res.user : u))
      );
      if (res.user.id === currentUser.id) {
        onCurrentUserUpdated(res.user);
      }
      setGeneratedPassword(res.generated_password);
      setStatusMsg(
        `Password for "${res.user.username}" has been reset to a new randomly-generated password.`
      );
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to reset password.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleDeleteSelectedUser = async () => {
    if (!selectedUser) return;
    const deletedUsername = selectedUser.username;
    const isSelf = selectedUser.id === currentUser.id;
    setDeleteUserBusy(true);
    try {
      await api.adminDeleteUser(selectedUser.id);
      if (isSelf) {
        setFeedback({
          type: "success",
          title: "Account Deleted",
          message: `Your administrator account (@${deletedUsername}) has been permanently deleted. You will now be redirected to the sign in screen.`,
          onConfirm: async () => {
            setFeedback(null);
            setShowDeleteUserConfirm(false);
            onClose();
            if (onAccountDeleted) {
              await onAccountDeleted(selectedUser.id);
            }
          },
        });
      } else {
        setFeedback({
          type: "success",
          title: "User Deleted",
          message: `User @${deletedUsername} and all their characters, worlds, and campaigns have been permanently deleted.`,
          onConfirm: async () => {
            setFeedback(null);
            setShowDeleteUserConfirm(false);
            await loadUsers(currentUser.id);
          },
        });
      }
    } catch (err: any) {
      setFeedback({
        type: "error",
        title: "User Deletion Error",
        message: err?.message || `Failed to delete user @${deletedUsername}.`,
        onConfirm: () => {
          setFeedback(null);
          setShowDeleteUserConfirm(false);
        },
      });
    } finally {
      setDeleteUserBusy(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    if (!newUsername.trim() || !newUserPassword) {
      setErrorMsg("Username and password are required.");
      return;
    }
    setActionBusy(true);
    try {
      const created = await api.adminCreateUser({
        username: newUsername.trim(),
        display_name: newDisplayName.trim() || newUsername.trim(),
        password: newUserPassword,
        role: newUserRole,
      });
      const updatedList = await api.adminListUsers();
      setUsers(updatedList);
      setSelectedUserId(created.id);
      setShowCreateUser(false);
      setNewUsername("");
      setNewDisplayName("");
      setNewUserPassword("");
      setStatusMsg(`Created user "${created.username}".`);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to create user.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleCopyGeneratedPassword = async () => {
    if (!generatedPassword) return;
    try {
      await navigator.clipboard.writeText(generatedPassword);
      setCopiedPwd(true);
      setTimeout(() => setCopiedPwd(false), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-panel" style={{ maxWidth: 740 }}>
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <UserCog size={18} color="var(--accent-amber)" />
            Admin Settings
          </span>
          <button type="button" className="btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        {/* Admin Modal Tabs */}
        <div className="modal-tabs">
          <button
            type="button"
            className={`modal-tab-btn ${
              activeTab === "users" ? "active" : ""
            }`}
            onClick={() => setActiveTab("users")}
          >
            <Users size={14} />
            Users ({users.length})
          </button>
          <button
            type="button"
            className={`modal-tab-btn ${
              activeTab === "models" ? "active" : ""
            }`}
            onClick={() => setActiveTab("models")}
          >
            <Cpu size={14} />
            Models
          </button>
        </div>

        <div className="modal-body" style={{ gap: 14 }}>
          {singleUserMode && (
            <div className="auth-warning-box" style={{ padding: "10px 12px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: "0.78rem",
                  color: "var(--accent-amber)",
                }}
              >
                <AlertTriangle size={15} />
                <span>
                  <strong>Single-User Local Mode Active:</strong> Multi-user
                  registration is disabled while the admin password is blank. Set
                  a password in your Profile or reset the admin password below to
                  enable multi-user support.
                </span>
              </div>
            </div>
          )}

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

          {activeTab === "users" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "250px 1fr",
                gap: 16,
                minHeight: 320,
              }}
            >
              {/* Left Column: Filterable Usernames List */}
              <div
                style={{
                  borderRight: "1px solid var(--border-subtle)",
                  paddingRight: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", gap: 6 }}>
                  <div className="sidebar-search-wrap" style={{ flex: 1 }}>
                    <Search size={13} className="sidebar-search-icon" />
                    <input
                      type="text"
                      className="sidebar-search-input"
                      placeholder="Filter usernames..."
                      value={filterQuery}
                      onChange={(e) => setFilterQuery(e.target.value)}
                    />
                  </div>
                  {!singleUserMode && (
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "5px 8px", fontSize: "0.74rem" }}
                      onClick={() => setShowCreateUser((prev) => !prev)}
                      title="Create a new user account"
                    >
                      <UserPlus size={13} />
                    </button>
                  )}
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    overflowY: "auto",
                    maxHeight: 300,
                  }}
                >
                  {loading ? (
                    <div
                      style={{
                        fontSize: "0.78rem",
                        color: "var(--text-muted)",
                        padding: 8,
                      }}
                    >
                      Loading users...
                    </div>
                  ) : filteredUsers.length > 0 ? (
                    filteredUsers.map((u) => (
                      <div
                        key={u.id}
                        className={`campaign-item ${
                          selectedUser?.id === u.id && !showCreateUser
                            ? "active"
                            : ""
                        }`}
                        onClick={() => {
                          setShowCreateUser(false);
                          setSelectedUserId(u.id);
                          setStatusMsg(null);
                          setErrorMsg(null);
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 6,
                            }}
                          >
                            <span
                              style={{
                                fontWeight: 600,
                                fontSize: "0.82rem",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {u.username}
                            </span>
                            <span
                              className="role-pill"
                              style={{
                                fontSize: "0.62rem",
                                padding: "1px 5px",
                                borderColor:
                                  u.role === "admin"
                                    ? "var(--accent-amber)"
                                    : "var(--border-subtle)",
                                color:
                                  u.role === "admin"
                                    ? "var(--accent-amber)"
                                    : "var(--text-secondary)",
                              }}
                            >
                              {u.role}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: "0.71rem",
                              color: "var(--text-secondary)",
                            }}
                          >
                            {u.display_name}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div
                      style={{
                        fontSize: "0.76rem",
                        color: "var(--text-muted)",
                        padding: 8,
                        textAlign: "center",
                      }}
                    >
                      No matching usernames
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Selected User Management OR Create User */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 14,
                }}
              >
                {showCreateUser && !singleUserMode ? (
                  <form
                    onSubmit={handleCreateUser}
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
                    <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>
                      Create New User Account
                    </div>
                    <div className="grid-2">
                      <div className="form-group">
                        <label className="form-label">Username</label>
                        <input
                          type="text"
                          className="form-input"
                          value={newUsername}
                          onChange={(e) => setNewUsername(e.target.value)}
                          placeholder="e.g. player_one"
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Display Name</label>
                        <input
                          type="text"
                          className="form-input"
                          value={newDisplayName}
                          onChange={(e) => setNewDisplayName(e.target.value)}
                          placeholder="Player One"
                        />
                      </div>
                    </div>
                    <div className="grid-2">
                      <div className="form-group">
                        <label className="form-label">Initial Password</label>
                        <input
                          type="password"
                          className="form-input"
                          value={newUserPassword}
                          onChange={(e) => setNewUserPassword(e.target.value)}
                          placeholder="Initial password..."
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Privilege Level</label>
                        <select
                          className="form-select"
                          value={newUserRole}
                          onChange={(e) =>
                            setNewUserRole(e.target.value as "user" | "admin")
                          }
                        >
                          <option value="user">user</option>
                          <option value="admin">admin</option>
                        </select>
                      </div>
                    </div>
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
                        onClick={() => setShowCreateUser(false)}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn btn-amber"
                        disabled={actionBusy}
                      >
                        <Plus size={14} />
                        <span>Create User</span>
                      </button>
                    </div>
                  </form>
                ) : selectedUser ? (
                  <>
                    {/* User Summary Card */}
                    <div
                      style={{
                        background: "var(--bg-card)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: 8,
                        padding: 14,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: "0.95rem",
                            color: "var(--text-primary)",
                          }}
                        >
                          @{selectedUser.username}
                        </div>
                        <div
                          style={{
                            fontSize: "0.76rem",
                            color: "var(--text-secondary)",
                            marginTop: 2,
                          }}
                        >
                          Display Name: {selectedUser.display_name} • Passkeys:{" "}
                          {selectedUser.passkeys.length}
                        </div>
                      </div>
                      <span
                        className="role-pill"
                        style={{
                          borderColor:
                            selectedUser.role === "admin"
                              ? "var(--accent-amber)"
                              : "var(--accent-cyan)",
                          color:
                            selectedUser.role === "admin"
                              ? "var(--accent-amber)"
                              : "var(--accent-cyan)",
                        }}
                      >
                        {selectedUser.role.toUpperCase()}
                      </span>
                    </div>

                    {/* Action 1: Change Username */}
                    <form
                      onSubmit={handleChangeUsername}
                      style={{
                        background: "var(--bg-card)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: 8,
                        padding: 14,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: "0.84rem" }}>
                        Change Username
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input
                          type="text"
                          className="form-input"
                          value={editUsername}
                          onChange={(e) => setEditUsername(e.target.value)}
                          placeholder="New username..."
                        />
                        <button
                          type="submit"
                          className="btn btn-amber"
                          disabled={
                            actionBusy ||
                            editUsername.trim() === selectedUser.username
                          }
                        >
                          Save Username
                        </button>
                      </div>
                    </form>

                    {/* Action 2: Reset Password to Randomly-Generated Password */}
                    <div
                      style={{
                        background: "var(--bg-card)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: 8,
                        padding: 14,
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, fontSize: "0.84rem" }}>
                            Reset Account Password
                          </div>
                          <div
                            style={{
                              fontSize: "0.74rem",
                              color: "var(--text-secondary)",
                            }}
                          >
                            Generates a cryptographically random password and
                            invalidates old sessions.
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-cyan"
                          onClick={handleResetPasswordRandom}
                          disabled={actionBusy}
                        >
                          <KeyRound size={14} />
                          <span>Reset to Random Password</span>
                        </button>
                      </div>

                      {generatedPassword && (
                        <div
                          style={{
                            marginTop: 6,
                            padding: "10px 12px",
                            borderRadius: 6,
                            background: "rgba(6, 182, 212, 0.1)",
                            border: "1px solid var(--accent-cyan)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 10,
                          }}
                        >
                          <div>
                            <div
                              style={{
                                fontSize: "0.7rem",
                                color: "var(--accent-cyan)",
                                textTransform: "uppercase",
                                fontWeight: 700,
                              }}
                            >
                              New Temporary Password (copy now):
                            </div>
                            <code
                              style={{
                                fontSize: "0.92rem",
                                fontWeight: 700,
                                color: "var(--text-primary)",
                                letterSpacing: "0.04em",
                              }}
                            >
                              {generatedPassword}
                            </code>
                          </div>
                          <button
                            type="button"
                            className="btn"
                            onClick={handleCopyGeneratedPassword}
                          >
                            {copiedPwd ? (
                              <>
                                <Check size={13} color="var(--accent-emerald)" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy size={13} />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Action 3: Delete Account */}
                    {(() => {
                      const adminCount = users.filter((u) => u.role === "admin").length;
                      const isOnlyAdmin =
                        selectedUser.role === "admin" && adminCount <= 1;

                      return (
                        <div
                          style={{
                            background: "var(--bg-card)",
                            border: "1px solid rgba(244, 63, 94, 0.3)",
                            borderRadius: 8,
                            padding: 14,
                            display: "flex",
                            flexDirection: "column",
                            gap: 10,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                            }}
                          >
                            <div>
                              <div
                                style={{
                                  fontWeight: 600,
                                  fontSize: "0.84rem",
                                  color: "#fda4af",
                                }}
                              >
                                Delete User Account
                              </div>
                              <div
                                style={{
                                  fontSize: "0.74rem",
                                  color: "var(--text-secondary)",
                                }}
                              >
                                Permanently delete this user, passkeys, sessions,
                                and all their characters, worlds, and campaigns.
                              </div>
                            </div>
                            {!showDeleteUserConfirm && (
                              <button
                                type="button"
                                className="btn btn-danger"
                                onClick={() => setShowDeleteUserConfirm(true)}
                                disabled={
                                  actionBusy || deleteUserBusy || isOnlyAdmin
                                }
                                title={
                                  isOnlyAdmin
                                    ? "Cannot delete the only remaining administrator account."
                                    : `Delete @${selectedUser.username}`
                                }
                              >
                                <Trash2 size={14} />
                                <span>Delete User</span>
                              </button>
                            )}
                          </div>

                          {isOnlyAdmin && (
                            <div
                              style={{
                                fontSize: "0.74rem",
                                color: "var(--accent-amber)",
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <AlertTriangle size={13} />
                              <span>
                                Cannot delete the only remaining administrator
                                account.
                              </span>
                            </div>
                          )}

                          {showDeleteUserConfirm && !isOnlyAdmin && (
                            <div
                              style={{
                                marginTop: 4,
                                padding: "10px 12px",
                                borderRadius: 6,
                                background: "rgba(244, 63, 94, 0.1)",
                                border: "1px solid rgba(244, 63, 94, 0.3)",
                                display: "flex",
                                flexDirection: "column",
                                gap: 8,
                              }}
                            >
                              <div
                                style={{
                                  fontSize: "0.76rem",
                                  color: "#fda4af",
                                }}
                              >
                                Are you sure you want to permanently delete user{" "}
                                <strong>@{selectedUser.username}</strong>? All
                                their characters, worlds, and campaigns will be
                                permanently erased.
                              </div>
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
                                  onClick={() =>
                                    setShowDeleteUserConfirm(false)
                                  }
                                  disabled={deleteUserBusy}
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-danger"
                                  onClick={handleDeleteSelectedUser}
                                  disabled={deleteUserBusy}
                                >
                                  {deleteUserBusy
                                    ? "Deleting..."
                                    : "Confirm Delete User"}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </>
                ) : null}
              </div>
            </div>
          )}

          {/* Admin Models Configuration Tab */}
          {activeTab === "models" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {!appSettingsForm ? (
                <div
                  style={{
                    padding: "24px 0",
                    textAlign: "center",
                    color: "var(--text-secondary)",
                    fontSize: "0.85rem",
                  }}
                >
                  Loading system model configuration...
                </div>
              ) : (
                <form
                  onSubmit={handleSaveSettings}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 14,
                  }}
                >
                  {/* Live Ollama Discovery Banner */}
                  <div
                    style={{
                      background: ollamaStatus?.reachable
                        ? "rgba(16, 185, 129, 0.1)"
                        : "rgba(244, 63, 94, 0.1)",
                      border: `1px solid ${
                        ollamaStatus?.reachable
                          ? "rgba(16, 185, 129, 0.4)"
                          : "rgba(244, 63, 94, 0.4)"
                      }`,
                      borderRadius: 8,
                      padding: "10px 14px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <Server
                        size={18}
                        color={
                          ollamaStatus?.reachable
                            ? "var(--accent-emerald)"
                            : "var(--accent-rose)"
                        }
                      />
                      <div style={{ fontSize: "0.8rem" }}>
                        {ollamaStatus?.reachable ? (
                          <>
                            <strong style={{ color: "#6ee7b7" }}>
                              Ollama Connected ({ollamaStatus.ollama_root_url})
                            </strong>
                            <div
                              style={{
                                color: "var(--text-secondary)",
                                fontSize: "0.74rem",
                              }}
                            >
                              {ollamaStatus.chat_models.length} chat model(s) &{" "}
                              {ollamaStatus.embedding_models.length} embedding
                              model(s) installed locally
                            </div>
                          </>
                        ) : (
                          <>
                            <strong style={{ color: "#fda4af" }}>
                              Ollama Unreachable (
                              {ollamaStatus?.ollama_root_url ??
                                appSettingsForm.actor_profile.base_url}
                              )
                            </strong>
                            <div
                              style={{
                                color: "var(--text-secondary)",
                                fontSize: "0.74rem",
                              }}
                            >
                              {ollamaStatus?.error ||
                                "Ensure `ollama serve` is running or check the base URL below."}
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn"
                      onClick={() =>
                        probeOllama(appSettingsForm.actor_profile.base_url)
                      }
                      disabled={probingOllama}
                    >
                      <RefreshCw size={13} />
                      {probingOllama ? "Probing..." : "Refresh Models"}
                    </button>
                  </div>

                  {/* Primary Actor Model Default */}
                  <div
                    style={{
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 8,
                      padding: 14,
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: "0.85rem",
                        color: "var(--accent-amber)",
                      }}
                    >
                      1. Default Primary Actor Model (Phase 3 &lt;cognition&gt;
                      + Narrative Prose)
                    </div>

                    <div className="grid-2">
                      <div className="form-group">
                        <label className="form-label">Ollama Server URL</label>
                        <input
                          type="text"
                          className="form-input"
                          value={appSettingsForm.actor_profile.base_url}
                          onChange={(e) =>
                            setAppSettingsForm({
                              ...appSettingsForm,
                              actor_profile: {
                                ...appSettingsForm.actor_profile,
                                base_url: e.target.value,
                              },
                            })
                          }
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">
                          Actor Ollama Model
                        </label>
                        {ollamaStatus?.chat_models &&
                        ollamaStatus.chat_models.length > 0 ? (
                          <select
                            className="form-input"
                            value={appSettingsForm.actor_profile.model}
                            onChange={(e) =>
                              setAppSettingsForm({
                                ...appSettingsForm,
                                actor_profile: {
                                  ...appSettingsForm.actor_profile,
                                  model: e.target.value,
                                },
                              })
                            }
                          >
                            {ollamaStatus.chat_models.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            className="form-input"
                            value={appSettingsForm.actor_profile.model}
                            onChange={(e) =>
                              setAppSettingsForm({
                                ...appSettingsForm,
                                actor_profile: {
                                  ...appSettingsForm.actor_profile,
                                  model: e.target.value,
                                },
                              })
                            }
                          />
                        )}
                      </div>
                    </div>

                    <div className="grid-2">
                      <div className="form-group">
                        <label className="form-label">
                          Default Temperature (
                          {appSettingsForm.actor_profile.temperature})
                        </label>
                        <input
                          type="range"
                          min="0.0"
                          max="2.0"
                          step="0.05"
                          value={appSettingsForm.actor_profile.temperature}
                          onChange={(e) =>
                            setAppSettingsForm({
                              ...appSettingsForm,
                              actor_profile: {
                                ...appSettingsForm.actor_profile,
                                temperature: parseFloat(e.target.value),
                              },
                            })
                          }
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Max Tokens</label>
                        <input
                          type="number"
                          min={64}
                          max={8192}
                          className="form-input"
                          value={appSettingsForm.actor_profile.max_tokens}
                          onChange={(e) =>
                            setAppSettingsForm({
                              ...appSettingsForm,
                              actor_profile: {
                                ...appSettingsForm.actor_profile,
                                max_tokens: parseInt(e.target.value, 10),
                              },
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>

                  {/* Auxiliary Clerk Model Default */}
                  <div
                    style={{
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 8,
                      padding: 14,
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: "0.85rem",
                        color: "var(--accent-cyan)",
                      }}
                    >
                      2. Default Auxiliary Clerk Model (Phase 1 Pre-Turn &amp;
                      Phase 4 State Clerk)
                    </div>

                    <div className="grid-2">
                      <div className="form-group">
                        <label className="form-label">Clerk Server URL</label>
                        <input
                          type="text"
                          className="form-input"
                          value={appSettingsForm.clerk_profile.base_url}
                          onChange={(e) =>
                            setAppSettingsForm({
                              ...appSettingsForm,
                              clerk_profile: {
                                ...appSettingsForm.clerk_profile,
                                base_url: e.target.value,
                              },
                            })
                          }
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">
                          Clerk Ollama Model
                        </label>
                        {ollamaStatus?.chat_models &&
                        ollamaStatus.chat_models.length > 0 ? (
                          <select
                            className="form-input"
                            value={appSettingsForm.clerk_profile.model}
                            onChange={(e) =>
                              setAppSettingsForm({
                                ...appSettingsForm,
                                clerk_profile: {
                                  ...appSettingsForm.clerk_profile,
                                  model: e.target.value,
                                },
                              })
                            }
                          >
                            {ollamaStatus.chat_models.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            className="form-input"
                            value={appSettingsForm.clerk_profile.model}
                            onChange={(e) =>
                              setAppSettingsForm({
                                ...appSettingsForm,
                                clerk_profile: {
                                  ...appSettingsForm.clerk_profile,
                                  model: e.target.value,
                                },
                              })
                            }
                          />
                        )}
                      </div>
                    </div>

                    <div className="grid-2">
                      <div className="form-group">
                        <label className="form-label">
                          Default Temperature (
                          {appSettingsForm.clerk_profile.temperature})
                        </label>
                        <input
                          type="range"
                          min="0.0"
                          max="2.0"
                          step="0.05"
                          value={appSettingsForm.clerk_profile.temperature}
                          onChange={(e) =>
                            setAppSettingsForm({
                              ...appSettingsForm,
                              clerk_profile: {
                                ...appSettingsForm.clerk_profile,
                                temperature: parseFloat(e.target.value),
                              },
                            })
                          }
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Max Tokens</label>
                        <input
                          type="number"
                          min={64}
                          max={8192}
                          className="form-input"
                          value={appSettingsForm.clerk_profile.max_tokens}
                          onChange={(e) =>
                            setAppSettingsForm({
                              ...appSettingsForm,
                              clerk_profile: {
                                ...appSettingsForm.clerk_profile,
                                max_tokens: parseInt(e.target.value, 10),
                              },
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>

                  {/* Semantic Vector Store & Memory Settings */}
                  <div
                    style={{
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 8,
                      padding: 14,
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: "0.85rem",
                        color: "var(--accent-emerald)",
                      }}
                    >
                      3. Semantic Vector Store &amp; 3-Tier Memory Settings
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr 1fr",
                        gap: 10,
                      }}
                    >
                      <div className="form-group">
                        <label className="form-label">Embedding Engine</label>
                        <select
                          className="form-input"
                          value={appSettingsForm.embedding_profile.mode}
                          onChange={(e) =>
                            setAppSettingsForm({
                              ...appSettingsForm,
                              embedding_profile: {
                                ...appSettingsForm.embedding_profile,
                                mode: e.target.value as AppSettings["embedding_profile"]["mode"],
                              },
                            })
                          }
                        >
                          <option value="local_hash">
                            Local Feature Hash (0 VRAM)
                          </option>
                          <option value="openai_compat">
                            Ollama /api/embed
                          </option>
                          <option value="fastembed">
                            Local ONNX FastEmbed
                          </option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label className="form-label">
                          Zone 3 Working Turns (N)
                        </label>
                        <input
                          type="number"
                          min={4}
                          max={64}
                          className="form-input"
                          value={
                            appSettingsForm.memory_config.working_memory_turns
                          }
                          onChange={(e) =>
                            setAppSettingsForm({
                              ...appSettingsForm,
                              memory_config: {
                                ...appSettingsForm.memory_config,
                                working_memory_turns: parseInt(
                                  e.target.value,
                                  10
                                ),
                              },
                            })
                          }
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">
                          Zone 2 Chunk Size (K)
                        </label>
                        <input
                          type="number"
                          min={2}
                          max={32}
                          className="form-input"
                          value={
                            appSettingsForm.memory_config.episodic_chunk_size
                          }
                          onChange={(e) =>
                            setAppSettingsForm({
                              ...appSettingsForm,
                              memory_config: {
                                ...appSettingsForm.memory_config,
                                episodic_chunk_size: parseInt(
                                  e.target.value,
                                  10
                                ),
                              },
                            })
                          }
                        />
                      </div>
                    </div>

                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: "0.82rem",
                        marginTop: 4,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={appSettingsForm.allow_offline_fallback}
                        onChange={(e) =>
                          setAppSettingsForm({
                            ...appSettingsForm,
                            allow_offline_fallback: e.target.checked,
                          })
                        }
                      />
                      Allow heuristic offline simulation if Ollama server is
                      unreachable
                    </label>
                  </div>

                  {/* Per-User Model Overrides Policy Toggle */}
                  <div
                    style={{
                      background: appSettingsForm.allow_user_model_overrides
                        ? "rgba(16, 185, 129, 0.08)"
                        : "var(--bg-card)",
                      border: `1px solid ${
                        appSettingsForm.allow_user_model_overrides
                          ? "rgba(16, 185, 129, 0.35)"
                          : "var(--border-subtle)"
                      }`,
                      borderRadius: 8,
                      padding: 14,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={appSettingsForm.allow_user_model_overrides}
                        onChange={(e) =>
                          setAppSettingsForm({
                            ...appSettingsForm,
                            allow_user_model_overrides: e.target.checked,
                          })
                        }
                        style={{ width: 16, height: 16 }}
                      />
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: "0.86rem",
                          color: appSettingsForm.allow_user_model_overrides
                            ? "#6ee7b7"
                            : "var(--text-primary)",
                        }}
                      >
                        Allow Per-User Model Overrides
                      </span>
                    </label>
                    <p
                      style={{
                        fontSize: "0.76rem",
                        color: "var(--text-secondary)",
                        margin: 0,
                        paddingLeft: 26,
                      }}
                    >
                      When enabled, individual users can customize their own
                      Actor and Clerk models and working memory window in their
                      Profile &gt; Models tab. When disabled, global admin
                      defaults are strictly enforced for all users.
                    </p>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: 10,
                      marginTop: 4,
                    }}
                  >
                    <button
                      type="submit"
                      className="btn btn-amber"
                      disabled={savingSettings}
                    >
                      <Check size={14} />
                      <span>
                        {savingSettings
                          ? "Saving Settings..."
                          : "Save System Model Settings"}
                      </span>
                    </button>
                  </div>
                </form>
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
