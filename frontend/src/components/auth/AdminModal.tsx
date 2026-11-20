import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Cpu,
  FileText,
  Megaphone,
  Server,
  Sliders,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { ApiError, api } from "../../api";
import { PromptPresetsManager } from "../PromptPresetsManager";
import { AppSettings, UserProfile } from "../../types";
import { FeedbackModal } from "./FeedbackModal";
import { ProvidersManager } from "../providers/ProvidersManager";
import { ProvidersProvider } from "../providers/ProvidersContext";
import { AdminUsersTab } from "./AdminUsersTab";
import { AdminModelsTab } from "./AdminModelsTab";
import { AdminServerConfigTab } from "./AdminServerConfigTab";
import { AdminCommunicationTab } from "./AdminCommunicationTab";

export type AdminModalTab =
  | "users"
  | "providers"
  | "models"
  | "prompts"
  | "server"
  | "communication";

export interface AdminModalProps {
  currentUser: UserProfile;
  singleUserMode: boolean;
  initialTab?: AdminModalTab;
  inactiveUserPurgeDays?: number | null;
  onClose: () => void;
  onCurrentUserUpdated: (updated: UserProfile) => void;
  onAccountDeleted?: (deletedUserId: string) => Promise<void>;
  onSettingsUpdated?: (updated: AppSettings) => void;
  onMessagesUpdated?: () => Promise<void> | void;
}

const AdminModalInner: React.FC<AdminModalProps> = ({
  currentUser,
  singleUserMode,
  initialTab,
  inactiveUserPurgeDays = null,
  onClose,
  onCurrentUserUpdated,
  onAccountDeleted,
  onSettingsUpdated,
  onMessagesUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<AdminModalTab>(
    singleUserMode && initialTab === "communication"
      ? "users"
      : (initialTab ?? "users")
  );
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [filterQuery, setFilterQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(
    currentUser.id
  );
  const [editUsername, setEditUsername] = useState("");
  const [loading, setLoading] = useState(false);

  // Models tab state
  const [appSettingsForm, setAppSettingsForm] = useState<AppSettings | null>(
    null
  );
  const [savingSettings, setSavingSettings] = useState(false);
  const [modelsDeckInvalid, setModelsDeckInvalid] = useState(0);
  const [staleEmbeddings, setStaleEmbeddings] = useState(0);
  const [reindexing, setReindexing] = useState(false);
  const [pendingPurgeConfirm, setPendingPurgeConfirm] = useState<{
    affectedProviders: number;
    affectedUsers: number;
    message: string;
  } | null>(null);

  const loadSettings = async () => {
    try {
      const cfg = await api.getSettings();
      setAppSettingsForm(cfg);
      api
        .getEmbeddingStatus()
        .then((st) => setStaleEmbeddings(st.stale_entries))
        .catch(() => undefined);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to load model settings.");
    }
  };

  useEffect(() => {
    if (
      (activeTab === "models" ||
        activeTab === "providers" ||
        activeTab === "server") &&
      !appSettingsForm
    ) {
      loadSettings();
    }
  }, [activeTab]);

  const handleReindex = async () => {
    setReindexing(true);
    setErrorMsg(null);
    try {
      const res = await api.reindexEmbeddings();
      setStaleEmbeddings(0);
      setStatusMsg(`Reindexed ${res.reindexed} stored memories.`);
    } catch (err: any) {
      setErrorMsg(err?.message || "Reindexing failed.");
    } finally {
      setReindexing(false);
    }
  };

  const submitSettingsUpdate = async (confirmCredentialPurge: boolean) => {
    if (!appSettingsForm) return;
    setSavingSettings(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      // The server is the authority: adopt its response (including the BYOP-coerced overrides flag).
      const updated = await api.updateSettings(appSettingsForm, {
        confirmCredentialPurge,
      });
      setPendingPurgeConfirm(null);
      setAppSettingsForm(updated);
      setStaleEmbeddings(updated.stale_embedding_entries);
      onSettingsUpdated?.(updated);
      setStatusMsg(
        updated.embedding_reindex_required
          ? "Settings saved. Stored memories use a different embedding model and are ignored until reindexed."
          : confirmCredentialPurge
            ? "Settings saved and stored personal provider credentials were purged from the database."
            : "Global system model settings and policies saved successfully."
      );
    } catch (err: any) {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        err.code === "user_credentials_purge_required"
      ) {
        const detail = err.payload?.detail ?? {};
        setPendingPurgeConfirm({
          affectedProviders: Number(detail.affected_providers ?? 0),
          affectedUsers: Number(detail.affected_users ?? 0),
          message:
            String(detail.message || "") ||
            "Enabling Browser Only will permanently delete stored personal provider credentials from the database.",
        });
        return;
      }
      setErrorMsg(err?.message || "Failed to save system model settings.");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitSettingsUpdate(false);
  };


  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);
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

  useEffect(() => {
    if (singleUserMode && activeTab === "communication") {
      setActiveTab("users");
    }
  }, [singleUserMode, activeTab]);


  const handleSelectTab = (tab: AdminModalTab) => {
    setStatusMsg(null);
    setErrorMsg(null);
    setActiveTab(tab);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-panel modal-panel--sheet">
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
        <div className="modal-tabs" role="tablist" aria-label="Admin sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "users"}
            className={`modal-tab-btn ${
              activeTab === "users" ? "active" : ""
            }`}
            onClick={() => handleSelectTab("users")}
          >
            <Users size={14} />
            Users ({users.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "providers"}
            className={`modal-tab-btn ${
              activeTab === "providers" ? "active" : ""
            }`}
            onClick={() => handleSelectTab("providers")}
          >
            <Server size={14} />
            Providers
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "models"}
            className={`modal-tab-btn ${
              activeTab === "models" ? "active" : ""
            }`}
            onClick={() => handleSelectTab("models")}
          >
            <Cpu size={14} />
            Models
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "prompts"}
            className={`modal-tab-btn ${
              activeTab === "prompts" ? "active" : ""
            }`}
            onClick={() => handleSelectTab("prompts")}
          >
            <FileText size={14} />
            Prompts & Presets
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "server"}
            className={`modal-tab-btn ${
              activeTab === "server" ? "active" : ""
            }`}
            onClick={() => handleSelectTab("server")}
          >
            <Sliders size={14} />
            Server Configuration
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "communication"}
            className={`modal-tab-btn ${
              activeTab === "communication" ? "active" : ""
            }${singleUserMode ? " is-disabled" : ""}`}
            disabled={singleUserMode}
            title={
              singleUserMode
                ? "Communication messages are disabled in single-user passwordless mode. Set an admin password to enable multi-user mode."
                : undefined
            }
            onClick={() => {
              if (!singleUserMode) handleSelectTab("communication");
            }}
          >
            <Megaphone size={14} />
            Communication
          </button>
        </div>

        <div className="modal-body" style={{ gap: 14 }} role="tabpanel">
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
            <AdminUsersTab
              currentUser={currentUser}
              singleUserMode={singleUserMode}
              inactiveUserPurgeDays={
                appSettingsForm?.inactive_user_purge_days ??
                inactiveUserPurgeDays
              }
              users={users}
              setUsers={setUsers}
              loadUsers={loadUsers}
              filterQuery={filterQuery}
              setFilterQuery={setFilterQuery}
              selectedUserId={selectedUserId}
              setSelectedUserId={setSelectedUserId}
              editUsername={editUsername}
              setEditUsername={setEditUsername}
              loading={loading}
              setStatusMsg={setStatusMsg}
              setErrorMsg={setErrorMsg}
              setFeedback={setFeedback}
              onCurrentUserUpdated={onCurrentUserUpdated}
              onAccountDeleted={onAccountDeleted}
              onClose={onClose}
            />
          )}

          {/* Admin Providers Tab */}
          {activeTab === "providers" && (
            <ProvidersManager
              variant="admin"
              allowUserProviders={!!appSettingsForm?.allow_user_providers}
              credentialStoreMode={
                appSettingsForm?.provider_credential_store ?? "prefer_server"
              }
            />
          )}

          {/* Admin Models Configuration Tab */}
          {activeTab === "models" && (
            <AdminModelsTab
              appSettingsForm={appSettingsForm}
              setAppSettingsForm={setAppSettingsForm}
              savingSettings={savingSettings}
              modelsDeckInvalid={modelsDeckInvalid}
              setModelsDeckInvalid={setModelsDeckInvalid}
              staleEmbeddings={staleEmbeddings}
              reindexing={reindexing}
              handleReindex={handleReindex}
              handleSaveSettings={handleSaveSettings}
            />
          )}

          {/* Admin Prompts & Presets Tab */}
          {activeTab === "prompts" && (
            <PromptPresetsManager
              onActivePresetChanged={async (presetId) => {
                await api.setActivePromptPreset(presetId);
              }}
            />
          )}

          {/* Admin Server Configuration Tab */}
          {activeTab === "server" && (
            <AdminServerConfigTab
              appSettingsForm={appSettingsForm}
              setAppSettingsForm={setAppSettingsForm}
              savingSettings={savingSettings}
              handleSaveSettings={handleSaveSettings}
              setStatusMsg={setStatusMsg}
              setErrorMsg={setErrorMsg}
              onUsersChanged={loadUsers}
            />
          )}

          {/* Admin Communication Tab */}
          {activeTab === "communication" && !singleUserMode && (
            <AdminCommunicationTab
              setStatusMsg={setStatusMsg}
              setErrorMsg={setErrorMsg}
              onMessagesUpdated={onMessagesUpdated}
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

      {pendingPurgeConfirm && (
        <div className="modal-backdrop" style={{ zIndex: 1200 }}>
          <div className="modal-panel" style={{ maxWidth: 480, padding: 0 }}>
            <div
              className="modal-header"
              style={{ borderColor: "rgba(244, 63, 94, 0.4)" }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: "#fda4af",
                }}
              >
                <AlertTriangle size={18} />
                Purge Stored Personal Credentials?
              </span>
            </div>
            <div
              className="modal-body"
              style={{
                padding: "18px 20px",
                fontSize: "0.86rem",
                lineHeight: 1.55,
                color: "var(--text-secondary)",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <p style={{ margin: 0 }}>{pendingPurgeConfirm.message}</p>
              <p style={{ margin: 0 }}>
                Affected: <strong>{pendingPurgeConfirm.affectedProviders}</strong>{" "}
                personal provider(s) across{" "}
                <strong>{pendingPurgeConfirm.affectedUsers}</strong> user
                account(s). Shared system providers are unaffected. Affected
                users will need to re-enter their API keys in their browser.
              </p>
            </div>
            <div
              style={{
                padding: "12px 20px",
                borderTop: "1px solid var(--border-subtle)",
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
              }}
            >
              <button
                type="button"
                className="btn"
                disabled={savingSettings}
                onClick={() => setPendingPurgeConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={savingSettings}
                onClick={() => void submitSettingsUpdate(true)}
              >
                {savingSettings ? "Purging..." : "Purge Credentials & Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const AdminModal: React.FC<AdminModalProps> = (props) => (
  <ProvidersProvider>
    <AdminModalInner {...props} />
  </ProvidersProvider>
);

