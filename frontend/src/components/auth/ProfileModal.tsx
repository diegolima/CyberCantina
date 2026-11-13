import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Lock,
  Sliders,
  User,
  X,
} from "lucide-react";
import { api } from "../../api";
import { UserProfile } from "../../types";
import { FeedbackModal } from "./FeedbackModal";
import { ProvidersProvider } from "../providers/ProvidersContext";
import { ProfileAccountTab } from "./ProfileAccountTab";
import { ProfilePreferencesTab } from "./ProfilePreferencesTab";

export interface ProfileModalProps {
  user: UserProfile;
  singleUserMode: boolean;
  inactiveUserPurgeDays?: number | null;
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
  inactiveUserPurgeDays = null,
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
  const [preferencesLocked, setPreferencesLocked] = useState(false);

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

  useEffect(() => {
    api.getProfileModels()
      .then((d) => setPreferencesLocked(!d.allow_user_model_overrides))
      .catch(() => undefined);
  }, []);

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
            {preferencesLocked && (
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


          {activeTab === "account" && (
            <ProfileAccountTab
              user={user}
              singleUserMode={singleUserMode}
              inactiveUserPurgeDays={inactiveUserPurgeDays}
              setStatusMsg={setStatusMsg}
              setErrorMsg={setErrorMsg}
              setFeedback={setFeedback}
              onUserUpdated={onUserUpdated}
              onAccountReset={onAccountReset}
              onAccountDeleted={onAccountDeleted}
              onClose={onClose}
            />
          )}

          {activeTab === "preferences" && (
            <ProfilePreferencesTab
              activePrefTab={activePrefTab}
              setActivePrefTab={setActivePrefTab}
              setStatusMsg={setStatusMsg}
              setErrorMsg={setErrorMsg}
              onLockStateChange={setPreferencesLocked}
            />
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

