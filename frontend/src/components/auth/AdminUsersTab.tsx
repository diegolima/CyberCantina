import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  KeyRound,
  Plus,
  Search,
  Trash2,
  UserPlus,
} from "lucide-react";
import { api } from "../../api";
import { UserProfile } from "../../types";

export interface AdminUsersTabProps {
  currentUser: UserProfile;
  singleUserMode: boolean;
  inactiveUserPurgeDays?: number | null;
  users: UserProfile[];
  setUsers: React.Dispatch<React.SetStateAction<UserProfile[]>>;
  loadUsers: (preferredUserId?: string | null) => Promise<void>;
  filterQuery: string;
  setFilterQuery: (q: string) => void;
  selectedUserId: string | null;
  setSelectedUserId: (id: string | null) => void;
  editUsername: string;
  setEditUsername: (name: string) => void;
  loading: boolean;
  setStatusMsg: (msg: string | null) => void;
  setErrorMsg: (msg: string | null) => void;
  setFeedback: (
    fb: {
      type: "success" | "error";
      title: string;
      message: string;
      onConfirm: () => void;
    } | null
  ) => void;
  onCurrentUserUpdated: (updated: UserProfile) => void;
  onAccountDeleted?: (deletedUserId: string) => Promise<void>;
  onClose: () => void;
}

function formatMediaBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatActivityTime(iso?: string | null): string {
  if (!iso) return "Never";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString();
}

function getPurgeBadge(
  u: UserProfile,
  purgeDays?: number | null
): { label: string; color: string } | null {
  if (!purgeDays || purgeDays <= 0 || u.role !== "user") return null;
  const basis = u.last_active_at || u.created_at;
  const ts = new Date(basis).getTime();
  if (Number.isNaN(ts)) return null;
  const daysElapsed = Math.floor((Date.now() - ts) / 86400000);
  const daysLeft = purgeDays - daysElapsed;
  if (daysLeft <= 0) {
    return { label: "Due for purge", color: "#fda4af" };
  }
  if (daysLeft <= 3) {
    return { label: `${daysLeft}d until purge`, color: "var(--accent-amber)" };
  }
  return { label: `${daysLeft}d left`, color: "var(--text-muted)" };
}

export const AdminUsersTab: React.FC<AdminUsersTabProps> = ({
  currentUser,
  singleUserMode,
  inactiveUserPurgeDays = null,
  users,
  setUsers,
  loadUsers,
  filterQuery,
  setFilterQuery,
  selectedUserId,
  setSelectedUserId,
  editUsername,
  setEditUsername,
  loading,
  setStatusMsg,
  setErrorMsg,
  setFeedback,
  onCurrentUserUpdated,
  onAccountDeleted,
  onClose,
}) => {
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(
    null
  );
  const [copiedPwd, setCopiedPwd] = useState(false);
  const [showDeleteUserConfirm, setShowDeleteUserConfirm] = useState(false);
  const [deleteUserBusy, setDeleteUserBusy] = useState(false);

  // Optional New User creation drawer
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"user" | "admin">("user");

  const [actionBusy, setActionBusy] = useState(false);

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
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 6,
                            }}
                          >
                            <span>{u.display_name}</span>
                            {(() => {
                              const badge = getPurgeBadge(
                                u,
                                inactiveUserPurgeDays
                              );
                              return badge ? (
                                <span
                                  style={{
                                    color: badge.color,
                                    fontWeight: 600,
                                    fontSize: "0.66rem",
                                  }}
                                >
                                  {badge.label}
                                </span>
                              ) : null;
                            })()}
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
                        <div
                          style={{
                            fontSize: "0.72rem",
                            color: "var(--text-muted)",
                            marginTop: 6,
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                          }}
                        >
                          <span>
                            Last Active:{" "}
                            {formatActivityTime(
                              selectedUser.last_active_at ??
                                selectedUser.created_at
                            )}{" "}
                            • Last Login:{" "}
                            {formatActivityTime(selectedUser.last_login_at)}
                          </span>
                          <span>
                            Media Storage:{" "}
                            {formatMediaBytes(selectedUser.media_bytes_used)}
                            {selectedUser.role === "admin"
                              ? " (Admin exempt from quota)"
                              : selectedUser.media_quota_bytes
                              ? ` / ${formatMediaBytes(
                                  selectedUser.media_quota_bytes
                                )}`
                              : " (No quota enforced)"}
                            {(() => {
                              const badge = getPurgeBadge(
                                selectedUser,
                                inactiveUserPurgeDays
                              );
                              return badge ? (
                                <>
                                  {" • "}
                                  <span
                                    style={{
                                      color: badge.color,
                                      fontWeight: 600,
                                    }}
                                  >
                                    {badge.label}
                                  </span>
                                </>
                              ) : null;
                            })()}
                          </span>
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
  );
};
