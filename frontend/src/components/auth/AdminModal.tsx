import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Cpu,
  FileText,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  Server,
  Trash2,
  UserCog,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { api } from "../../api";
import { PromptPresetsManager } from "../PromptPresetsManager";
import {
  AppSettings,
  OllamaStatusResponse,
  UserProfile,
} from "../../types";
import { FeedbackModal } from "./FeedbackModal";

export interface AdminModalProps {
  currentUser: UserProfile;
  singleUserMode: boolean;
  initialTab?: "users" | "models" | "prompts";
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
  const [activeTab, setActiveTab] = useState<"users" | "models" | "prompts">(
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
                        gridTemplateColumns: "1fr 1fr 1fr 1fr",
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

                      <div className="form-group">
                        <label className="form-label">
                          Max Scene Flags (FIFO)
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={50}
                          className="form-input"
                          value={
                            appSettingsForm.memory_config.max_scene_flags ?? 10
                          }
                          onChange={(e) =>
                            setAppSettingsForm({
                              ...appSettingsForm,
                              memory_config: {
                                ...appSettingsForm.memory_config,
                                max_scene_flags: parseInt(
                                  e.target.value,
                                  10
                                ) || 10,
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

                  {/* Delegate Character Cognition to Clerk Model */}
                  <div
                    style={{
                      background: appSettingsForm.delegate_cognition_to_clerk
                        ? "rgba(16, 185, 129, 0.08)"
                        : "var(--bg-card)",
                      border: `1px solid ${
                        appSettingsForm.delegate_cognition_to_clerk
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
                        checked={appSettingsForm.delegate_cognition_to_clerk || false}
                        onChange={(e) =>
                          setAppSettingsForm({
                            ...appSettingsForm,
                            delegate_cognition_to_clerk: e.target.checked,
                          })
                        }
                        style={{ width: 16, height: 16 }}
                      />
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: "0.86rem",
                          color: appSettingsForm.delegate_cognition_to_clerk
                            ? "#6ee7b7"
                            : "var(--text-primary)",
                        }}
                      >
                        Delegate Character Cognition to Clerk Model
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
                      When enabled, the analytical Clerk model generates the 4-step &lt;cognition&gt; block (Recall, Feeling, Want, Plan) and injects it as context for the Primary Actor model. Ideal for prose-only fine-tuned models that struggle with XML generation.
                    </p>
                  </div>

                  {/* Character Agent Dispatch Mode */}
                  <div
                    style={{
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 8,
                      padding: 14,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <label
                      style={{
                        fontWeight: 600,
                        fontSize: "0.86rem",
                        color: "var(--text-primary)",
                      }}
                    >
                      Character Agent Dispatch Mode
                    </label>
                    <select
                      className="field-select"
                      value={appSettingsForm.agent_dispatch_mode ?? "sequential"}
                      onChange={(e) =>
                        setAppSettingsForm({
                          ...appSettingsForm,
                          agent_dispatch_mode: e.target.value as "sequential" | "parallel",
                        })
                      }
                    >
                      <option value="sequential">
                        Sequential — One Agent at a Time (Recommended for Single Local GPU / Ollama)
                      </option>
                      <option value="parallel">
                        Parallel — Concurrent Dispatch (Cloud APIs / Multi-Slot vLLM)
                      </option>
                    </select>
                    <p
                      style={{
                        fontSize: "0.76rem",
                        color: "var(--text-secondary)",
                        margin: 0,
                      }}
                    >
                      Controls whether per-character state agents execute one-by-one (avoiding queue timeouts on single-GPU setups) or concurrently via asyncio.gather.
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

          {/* Admin Prompts & Presets Tab */}
          {activeTab === "prompts" && <PromptPresetsManager />}
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
