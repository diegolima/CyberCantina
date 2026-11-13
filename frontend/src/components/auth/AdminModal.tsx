import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Cpu,
  FileText,
  Server,
  Sliders,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { api } from "../../api";
import { PromptPresetsManager } from "../PromptPresetsManager";
import { AppSettings, UserProfile } from "../../types";
import { FeedbackModal } from "./FeedbackModal";
import { ProvidersManager } from "../providers/ProvidersManager";
import { ProvidersProvider } from "../providers/ProvidersContext";
import { AdminUsersTab } from "./AdminUsersTab";
import { AdminModelsTab } from "./AdminModelsTab";
import { AdminServerConfigTab } from "./AdminServerConfigTab";

export interface AdminModalProps {
  currentUser: UserProfile;
  singleUserMode: boolean;
  initialTab?: "users" | "providers" | "models" | "prompts" | "server";
  inactiveUserPurgeDays?: number | null;
  onClose: () => void;
  onCurrentUserUpdated: (updated: UserProfile) => void;
  onAccountDeleted?: (deletedUserId: string) => Promise<void>;
  onSettingsUpdated?: (updated: AppSettings) => void;
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
}) => {
  const [activeTab, setActiveTab] = useState<
    "users" | "providers" | "models" | "prompts" | "server"
  >(initialTab ?? "users");
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

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appSettingsForm) return;
    setSavingSettings(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      // The server is the authority: adopt its response (including the BYOP-coerced overrides flag).
      const updated = await api.updateSettings(appSettingsForm);
      setAppSettingsForm(updated);
      setStaleEmbeddings(updated.stale_embedding_entries);
      onSettingsUpdated?.(updated);
      setStatusMsg(
        updated.embedding_reindex_required
          ? "Settings saved. Stored memories use a different embedding model and are ignored until reindexed."
          : "Global system model settings and policies saved successfully."
      );
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to save system model settings.");
    } finally {
      setSavingSettings(false);
    }
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


  return (
    <div className="modal-backdrop">
      <div
        className="modal-panel"
        style={{
          maxWidth:
            activeTab === "models" ||
            activeTab === "prompts" ||
            activeTab === "server"
              ? 880
              : 740,
          width:
            activeTab === "models" ||
            activeTab === "prompts" ||
            activeTab === "server"
              ? "min(880px, 95vw)"
              : undefined,
          transition: "max-width 0.2s ease",
        }}
      >
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
              activeTab === "providers" ? "active" : ""
            }`}
            onClick={() => setActiveTab("providers")}
          >
            <Server size={14} />
            Providers
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
          <button
            type="button"
            className={`modal-tab-btn ${
              activeTab === "prompts" ? "active" : ""
            }`}
            onClick={() => setActiveTab("prompts")}
          >
            <FileText size={14} />
            Prompts & Presets
          </button>
          <button
            type="button"
            className={`modal-tab-btn ${
              activeTab === "server" ? "active" : ""
            }`}
            onClick={() => setActiveTab("server")}
          >
            <Sliders size={14} />
            Server Configuration
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

export const AdminModal: React.FC<AdminModalProps> = (props) => (
  <ProvidersProvider>
    <AdminModalInner {...props} />
  </ProvidersProvider>
);

