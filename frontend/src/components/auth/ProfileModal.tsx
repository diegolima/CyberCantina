import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Lock,
  Sliders,
  User,
  X,
} from "lucide-react";
import { api } from "../../api";
import { ProfileModelSettingsResponse, UserProfile } from "../../types";
import {
  hasExplicitPrefSubTab,
  ProfileInitialTab,
  ProfilePrefSubTab,
  ProfileTopTab,
  resolveProfileInitialTab,
  resolveProfilePrefSubTab,
} from "../../utils/profilePreferences";
import { FeedbackModal } from "./FeedbackModal";
import { ProvidersProvider } from "../providers/ProvidersContext";
import { ProfileAccountTab } from "./ProfileAccountTab";
import { ProfilePreferencesTab } from "./ProfilePreferencesTab";

export interface ProfileModalProps {
  user: UserProfile;
  singleUserMode: boolean;
  inactiveUserPurgeDays?: number | null;
  initialTab?: ProfileInitialTab;
  initialSubTab?: ProfilePrefSubTab;
  initialModelSettings?: ProfileModelSettingsResponse | null;
  onClose: () => void;
  onUserUpdated: (updated: UserProfile, singleUserMode?: boolean) => void;
  onAccountReset: () => Promise<void>;
  onAccountDeleted: () => Promise<void>;
  onDefaultsRestored?: () => Promise<void>;
}

const ProfileModalInner: React.FC<ProfileModalProps> = ({
  user,
  singleUserMode,
  inactiveUserPurgeDays = null,
  initialTab,
  initialSubTab,
  initialModelSettings = null,
  onClose,
  onUserUpdated,
  onAccountReset,
  onAccountDeleted,
  onDefaultsRestored,
}) => {
  const [activeTab, setActiveTab] = useState<ProfileTopTab>(() =>
    resolveProfileInitialTab(initialTab)
  );
  const [activePrefTab, setActivePrefTab] = useState<ProfilePrefSubTab>(() =>
    resolveProfilePrefSubTab({
      initialTab,
      initialSubTab,
      allowUserProviders: initialModelSettings?.allow_user_providers,
    })
  );
  const [preferencesLocked, setPreferencesLocked] = useState(() =>
    initialModelSettings ? !initialModelSettings.allow_user_model_overrides : false
  );

  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    api
      .getProfileModels()
      .then((d) => setPreferencesLocked(!d.allow_user_model_overrides))
      .catch(() => undefined);
  }, []);

  const handleSelectTab = useCallback((tab: ProfileTopTab) => {
    setStatusMsg(null);
    setErrorMsg(null);
    setActiveTab(tab);
  }, []);

  const handleSelectPrefTab = useCallback((subTab: ProfilePrefSubTab) => {
    setStatusMsg(null);
    setErrorMsg(null);
    setActivePrefTab(subTab);
  }, []);

  return (
    <div className="modal-backdrop">
      <div className="modal-panel profile-modal-panel">
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <User size={18} color="var(--accent-amber)" />
            User Profile &amp; Preferences
          </span>
          <button
            type="button"
            className="btn"
            onClick={onClose}
            aria-label="Close User Profile"
          >
            <X size={15} />
          </button>
        </div>

        {/* Profile Modal Tabs (Preferences -> Account) */}
        <div className="modal-tabs" role="tablist" aria-label="Profile sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "preferences"}
            className={`modal-tab-btn ${
              activeTab === "preferences" ? "active" : ""
            }`}
            onClick={() => handleSelectTab("preferences")}
          >
            <Sliders size={14} />
            Preferences
            {preferencesLocked && (
              <span className="modal-tab-badge">Locked</span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "account"}
            className={`modal-tab-btn ${
              activeTab === "account" ? "active" : ""
            }`}
            onClick={() => handleSelectTab("account")}
          >
            <Lock size={14} />
            Account
          </button>
        </div>

        <div className="modal-body" style={{ gap: 18 }} role="tabpanel">
          {statusMsg && (
            <div className="auth-alert auth-alert-success">
              <Check size={15} />
              <span>{statusMsg}</span>
            </div>
          )}

          {errorMsg && (
            <div className="auth-alert auth-alert-error" role="alert">
              <AlertTriangle size={15} />
              <span>{errorMsg}</span>
            </div>
          )}

          {activeTab === "preferences" && (
            <ProfilePreferencesTab
              activePrefTab={activePrefTab}
              setActivePrefTab={handleSelectPrefTab}
              hasExplicitSubTab={hasExplicitPrefSubTab(initialTab, initialSubTab)}
              setStatusMsg={setStatusMsg}
              setErrorMsg={setErrorMsg}
              onLockStateChange={setPreferencesLocked}
              initialModelSettings={initialModelSettings}
            />
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
              onDefaultsRestored={onDefaultsRestored}
              onClose={onClose}
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
