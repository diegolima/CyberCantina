import React, { useEffect, useMemo, useState } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  Clock,
  Edit3,
  GripVertical,
  Info,
  Megaphone,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../../api";
import type {
  AdminMessageRecord,
  AdminMessageWritePayload,
  MessagePlacement,
  MessageUrgency,
} from "../../types";
import {
  fromLocalDateTimeInputValue,
  toLocalDateTimeInputValue,
} from "../../utils/adminMessageState";

export interface AdminCommunicationTabProps {
  setStatusMsg: (msg: string | null) => void;
  setErrorMsg: (msg: string | null) => void;
  onMessagesUpdated?: () => Promise<void> | void;
}

const URGENCY_GROUPS: Array<{
  urgency: MessageUrgency;
  label: string;
  description: string;
}> = [
  {
    urgency: "critical",
    label: "Critical",
    description: "Shown first in rose/red for urgent outages or immediate action.",
  },
  {
    urgency: "warning",
    label: "Warning",
    description: "Shown second in amber/yellow for planned maintenance or cautions.",
  },
  {
    urgency: "info",
    label: "Info",
    description: "Shown last in cyan/blue for general updates and tips.",
  },
];

function formatDateTimeDisplay(iso?: string | null): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString();
}

function formatPlacementLabel(placement: MessagePlacement): string {
  if (placement === "login") return "Login";
  if (placement === "home") return "Home";
  return "Login & Home";
}

function getLocalTimezoneLabel(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time";
  } catch {
    return "Local time";
  }
}

export const AdminCommunicationTab: React.FC<AdminCommunicationTabProps> = ({
  setStatusMsg,
  setErrorMsg,
  onMessagesUpdated,
}) => {
  const [subTab, setSubTab] = useState<"active" | "archived">("active");
  const [activeMessages, setActiveMessages] = useState<AdminMessageRecord[]>([]);
  const [archivedMessages, setArchivedMessages] = useState<AdminMessageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Create/Edit form state
  const [showForm, setShowForm] = useState(false);
  const [editingMsg, setEditingMsg] = useState<AdminMessageRecord | null>(null);
  const [expiredAutoClearedNote, setExpiredAutoClearedNote] = useState(false);
  const [placement, setPlacement] = useState<MessagePlacement>("both");
  const [urgency, setUrgency] = useState<MessageUrgency>("info");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [startsAtLocal, setStartsAtLocal] = useState("");
  const [expiresAtLocal, setExpiresAtLocal] = useState("");
  const [dismissable, setDismissable] = useState(true);

  // Drag-and-drop state (constrained within same urgency group)
  const [draggingState, setDraggingState] = useState<{
    id: string;
    urgency: MessageUrgency;
  } | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const localTzLabel = useMemo(() => getLocalTimezoneLabel(), []);

  const loadMessages = async () => {
    setLoading(true);
    try {
      const res = await api.adminListMessages();
      setActiveMessages(res.active);
      setArchivedMessages(res.archived);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to load communication messages.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMessages();
  }, []);

  const resetForm = () => {
    setShowForm(false);
    setEditingMsg(null);
    setExpiredAutoClearedNote(false);
    setPlacement("both");
    setUrgency("info");
    setTitle("");
    setMessage("");
    setStartsAtLocal("");
    setExpiresAtLocal("");
    setDismissable(true);
  };

  const openCreateForm = () => {
    setErrorMsg(null);
    setStatusMsg(null);
    setEditingMsg(null);
    setExpiredAutoClearedNote(false);
    setPlacement("both");
    setUrgency("info");
    setTitle("");
    setMessage("");
    setStartsAtLocal("");
    setExpiresAtLocal("");
    setDismissable(true);
    setShowForm(true);
  };

  const openEditForm = (msg: AdminMessageRecord) => {
    setErrorMsg(null);
    setStatusMsg(null);
    const wasExpired = msg.status === "expired";
    setEditingMsg(msg);
    setExpiredAutoClearedNote(wasExpired);
    setPlacement(msg.placement);
    setUrgency(msg.urgency);
    setTitle(msg.title);
    setMessage(msg.message);
    setStartsAtLocal(toLocalDateTimeInputValue(msg.starts_at));
    setExpiresAtLocal(wasExpired ? "" : toLocalDateTimeInputValue(msg.expires_at));
    setDismissable(msg.dismissable);
    setShowForm(true);
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);

    const cleanTitle = title.trim();
    const cleanBody = message.trim();
    if (!cleanTitle) {
      setErrorMsg("Message title is required.");
      return;
    }
    if (!cleanBody) {
      setErrorMsg("Message content is required.");
      return;
    }

    const startsIso = fromLocalDateTimeInputValue(startsAtLocal);
    const expiresIso = fromLocalDateTimeInputValue(expiresAtLocal);

    if (startsAtLocal.trim() && !startsIso) {
      setErrorMsg("Invalid 'From' date/time value.");
      return;
    }
    if (expiresAtLocal.trim() && !expiresIso) {
      setErrorMsg("Invalid 'Until' date/time value.");
      return;
    }
    if (expiresIso) {
      const expMs = Date.parse(expiresIso);
      if (expMs < Date.now()) {
        setErrorMsg("Effective 'Until' date/time must be empty or in the future (>= now).");
        return;
      }
      if (startsIso && expMs <= Date.parse(startsIso)) {
        setErrorMsg("Effective 'Until' date/time must be after 'From' date/time.");
        return;
      }
    }

    const payload: AdminMessageWritePayload = {
      placement,
      title: cleanTitle,
      message: cleanBody,
      urgency,
      dismissable,
      starts_at: startsIso,
      expires_at: expiresIso,
    };

    setSaving(true);
    try {
      const wasArchived =
        editingMsg !== null &&
        (editingMsg.status === "deleted" || editingMsg.status === "expired");
      if (editingMsg) {
        const updated = await api.adminUpdateMessage(editingMsg.id, payload);
        setStatusMsg(
          wasArchived
            ? `Message restored to Active (rev ${updated.revision}).`
            : `Message updated (rev ${updated.revision}).`
        );
      } else {
        await api.adminCreateMessage(payload);
        setStatusMsg("Communication message created.");
      }
      resetForm();
      setSubTab("active");
      await loadMessages();
      await onMessagesUpdated?.();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to save communication message.");
    } finally {
      setSaving(false);
    }
  };

  const handleSoftDelete = async (msg: AdminMessageRecord) => {
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await api.adminDeleteMessage(msg.id);
      if (editingMsg?.id === msg.id) {
        resetForm();
      }
      setStatusMsg(`Moved "${msg.title}" to Archived.`);
      await loadMessages();
      await onMessagesUpdated?.();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to delete message.");
    }
  };

  const persistGroupOrder = async (
    groupUrgency: MessageUrgency,
    reorderedGroup: AdminMessageRecord[]
  ) => {
    const orderedIds = reorderedGroup.map((m) => m.id);
    // Optimistically update group order in UI
    setActiveMessages((prev) => {
      const others = prev.filter((m) => m.urgency !== groupUrgency);
      const next = [...others, ...reorderedGroup];
      const rank = { critical: 0, warning: 1, info: 2 };
      next.sort((a, b) => rank[a.urgency] - rank[b.urgency]);
      return next;
    });
    try {
      const updated = await api.adminReorderMessages(groupUrgency, orderedIds);
      setActiveMessages(updated);
      await onMessagesUpdated?.();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to reorder messages.");
      await loadMessages();
    }
  };

  const handleMoveWithinGroup = async (
    groupUrgency: MessageUrgency,
    index: number,
    delta: -1 | 1
  ) => {
    const group = activeMessages.filter((m) => m.urgency === groupUrgency);
    const targetIdx = index + delta;
    if (targetIdx < 0 || targetIdx >= group.length) return;
    const nextGroup = [...group];
    const [moved] = nextGroup.splice(index, 1);
    nextGroup.splice(targetIdx, 0, moved);
    await persistGroupOrder(groupUrgency, nextGroup);
  };

  const handleDropOnCard = async (
    targetMsg: AdminMessageRecord
  ) => {
    setDragOverId(null);
    if (!draggingState) return;
    if (
      draggingState.urgency !== targetMsg.urgency ||
      draggingState.id === targetMsg.id
    ) {
      setDraggingState(null);
      return;
    }
    const group = activeMessages.filter((m) => m.urgency === targetMsg.urgency);
    const fromIdx = group.findIndex((m) => m.id === draggingState.id);
    const toIdx = group.findIndex((m) => m.id === targetMsg.id);
    setDraggingState(null);
    if (fromIdx < 0 || toIdx < 0) return;

    const nextGroup = [...group];
    const [moved] = nextGroup.splice(fromIdx, 1);
    nextGroup.splice(toIdx, 0, moved);
    await persistGroupOrder(targetMsg.urgency, nextGroup);
  };

  return (
    <div className="admin-comm-tab">
      <div className="admin-comm-toolbar">
        <div className="admin-comm-subtabs" role="tablist" aria-label="Message status">
          <button
            type="button"
            role="tab"
            aria-selected={subTab === "active"}
            className={`btn btn-sm ${subTab === "active" ? "btn-amber" : ""}`}
            onClick={() => setSubTab("active")}
          >
            <Megaphone size={13} />
            Active ({activeMessages.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subTab === "archived"}
            className={`btn btn-sm ${subTab === "archived" ? "btn-amber" : ""}`}
            onClick={() => setSubTab("archived")}
          >
            <Archive size={13} />
            Archived ({archivedMessages.length})
          </button>
        </div>

        {!showForm && (
          <button
            type="button"
            className="btn btn-amber btn-sm"
            onClick={openCreateForm}
          >
            <Plus size={14} />
            New Message
          </button>
        )}
      </div>

      {showForm && (
        <form className="admin-comm-form" onSubmit={handleSubmitForm}>
          <div className="admin-comm-form-header">
            <span>
              {editingMsg
                ? editingMsg.status === "deleted" || editingMsg.status === "expired"
                  ? "Edit & Restore Message"
                  : `Edit Message (rev ${editingMsg.revision})`
                : "Create Communication Message"}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={resetForm}
              aria-label="Cancel message form"
            >
              <X size={14} />
            </button>
          </div>

          {expiredAutoClearedNote && (
            <div className="auth-alert auth-alert-info" style={{ fontSize: "0.76rem" }}>
              <Clock size={14} style={{ flexShrink: 0 }} />
              <span>
                This expired message&apos;s <strong>Until</strong> timestamp was cleared so
                you can restore it immediately or choose a new future expiration.
              </span>
            </div>
          )}

          <div className="admin-comm-form-grid">
            <div className="field-group">
              <label htmlFor="admin-msg-placement">Placement</label>
              <select
                id="admin-msg-placement"
                className="field-input"
                value={placement}
                onChange={(e) => setPlacement(e.target.value as MessagePlacement)}
                disabled={saving}
              >
                <option value="both">Login &amp; Home</option>
                <option value="login">Login / Registration only</option>
                <option value="home">User Home only</option>
              </select>
            </div>

            <div className="field-group">
              <label htmlFor="admin-msg-urgency">Urgency</label>
              <select
                id="admin-msg-urgency"
                className="field-input"
                value={urgency}
                onChange={(e) => setUrgency(e.target.value as MessageUrgency)}
                disabled={saving}
              >
                <option value="info">Info (Cyan)</option>
                <option value="warning">Warning (Amber)</option>
                <option value="critical">Critical (Rose)</option>
              </select>
            </div>
          </div>

          <div className="field-group">
            <label htmlFor="admin-msg-title">Title</label>
            <input
              id="admin-msg-title"
              type="text"
              className="field-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="e.g., Scheduled Maintenance Window Tonight"
              disabled={saving}
              required
            />
          </div>

          <div className="field-group">
            <label htmlFor="admin-msg-body">Message</label>
            <textarea
              id="admin-msg-body"
              className="field-input"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={2000}
              placeholder="Details shown to users (plain text, line breaks and https:// links supported)..."
              disabled={saving}
              required
            />
          </div>

          <div className="admin-comm-form-grid">
            <div className="field-group">
              <label htmlFor="admin-msg-from">
                From <span className="form-hint">(optional · {localTzLabel})</span>
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  id="admin-msg-from"
                  type="datetime-local"
                  className="field-input"
                  value={startsAtLocal}
                  onChange={(e) => setStartsAtLocal(e.target.value)}
                  disabled={saving}
                />
                {startsAtLocal && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setStartsAtLocal("")}
                    disabled={saving}
                    title="Clear From date"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="field-group">
              <label htmlFor="admin-msg-until">
                Until <span className="form-hint">(optional, &ge; now)</span>
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  id="admin-msg-until"
                  type="datetime-local"
                  className="field-input"
                  value={expiresAtLocal}
                  onChange={(e) => setExpiresAtLocal(e.target.value)}
                  disabled={saving}
                />
                {expiresAtLocal && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setExpiresAtLocal("")}
                    disabled={saving}
                    title="Clear Until date"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          <label className="admin-comm-checkbox">
            <input
              type="checkbox"
              checked={dismissable}
              onChange={(e) => setDismissable(e.target.checked)}
              disabled={saving}
            />
            <span>
              Dismissable{" "}
              <span className="form-hint">
                (users can close with X; editing re-displays the updated revision)
              </span>
            </span>
          </label>

          <div className="admin-comm-form-actions">
            <button
              type="button"
              className="btn btn-sm"
              onClick={resetForm}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-amber btn-sm" disabled={saving}>
              <Save size={13} />
              {saving
                ? "Saving..."
                : editingMsg &&
                    (editingMsg.status === "deleted" ||
                      editingMsg.status === "expired")
                  ? "Save & Restore"
                  : editingMsg
                    ? "Save Changes"
                    : "Publish Message"}
            </button>
          </div>
        </form>
      )}

      {loading && activeMessages.length === 0 && archivedMessages.length === 0 ? (
        <div className="ui-empty-state ui-empty-state--dashed">Loading communication messages...</div>
      ) : subTab === "active" ? (
        activeMessages.length === 0 ? (
          <div className="ui-empty-state ui-empty-state--dashed">
            No active or scheduled messages. Click <strong>New Message</strong> to
            post an announcement to Login or Home.
          </div>
        ) : (
          <div className="admin-comm-groups">
            {URGENCY_GROUPS.map((group) => {
              const items = activeMessages.filter(
                (m) => m.urgency === group.urgency
              );
              if (items.length === 0) return null;
              return (
                <section
                  key={group.urgency}
                  className={`admin-comm-group is-${group.urgency}`}
                >
                  <div className="admin-comm-group-header">
                    <span className="admin-comm-group-title">
                      {group.urgency === "critical" ? (
                        <AlertOctagon size={14} />
                      ) : group.urgency === "warning" ? (
                        <AlertTriangle size={14} />
                      ) : (
                        <Info size={14} />
                      )}
                      {group.label} ({items.length})
                    </span>
                    <span className="admin-comm-group-hint">
                      Drag or use arrows to sort within {group.label}
                    </span>
                  </div>

                  <div className="admin-comm-list">
                    {items.map((item, idx) => (
                      <div
                        key={item.id}
                        className={`admin-comm-item is-${item.urgency} ${
                          dragOverId === item.id ? "is-drag-over" : ""
                        }`}
                        draggable={items.length > 1}
                        onDragStart={(e) => {
                          setDraggingState({
                            id: item.id,
                            urgency: item.urgency,
                          });
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragEnd={() => {
                          setDraggingState(null);
                          setDragOverId(null);
                        }}
                        onDragOver={(e) => {
                          if (
                            draggingState &&
                            draggingState.urgency === item.urgency &&
                            draggingState.id !== item.id
                          ) {
                            e.preventDefault();
                            setDragOverId(item.id);
                          }
                        }}
                        onDragLeave={() => {
                          if (dragOverId === item.id) setDragOverId(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          void handleDropOnCard(item);
                        }}
                      >
                        <div className="admin-comm-item-grip" title="Drag to reorder">
                          <GripVertical size={15} />
                        </div>

                        <div className="admin-comm-item-main">
                          <div className="admin-comm-item-top">
                            <span className="admin-comm-item-title">
                              {item.title}
                            </span>
                            <span className="admin-comm-pill">
                              {formatPlacementLabel(item.placement)}
                            </span>
                            <span className="admin-comm-pill">
                              {item.dismissable ? "Dismissable" : "Pinned"}
                            </span>
                            {item.status === "scheduled" && (
                              <span className="admin-comm-pill is-scheduled">
                                Scheduled
                              </span>
                            )}
                            <span className="admin-comm-rev">rev {item.revision}</span>
                          </div>
                          <div className="admin-comm-item-preview">{item.message}</div>
                          {(item.starts_at || item.expires_at) && (
                            <div className="admin-comm-item-dates">
                              {item.starts_at && (
                                <span>
                                  From: {formatDateTimeDisplay(item.starts_at)}
                                </span>
                              )}
                              {item.expires_at && (
                                <span>
                                  Until: {formatDateTimeDisplay(item.expires_at)}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="admin-comm-item-actions">
                          {items.length > 1 && (
                            <>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={idx === 0}
                                onClick={() =>
                                  void handleMoveWithinGroup(group.urgency, idx, -1)
                                }
                                title="Move up"
                                aria-label={`Move ${item.title} up`}
                              >
                                <ArrowUp size={13} />
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                disabled={idx === items.length - 1}
                                onClick={() =>
                                  void handleMoveWithinGroup(group.urgency, idx, 1)
                                }
                                title="Move down"
                                aria-label={`Move ${item.title} down`}
                              >
                                <ArrowDown size={13} />
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => openEditForm(item)}
                            title="Edit message"
                            aria-label={`Edit ${item.title}`}
                          >
                            <Edit3 size={13} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => void handleSoftDelete(item)}
                            title="Delete (move to Archived)"
                            aria-label={`Delete ${item.title}`}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )
      ) : archivedMessages.length === 0 ? (
        <div className="ui-empty-state ui-empty-state--dashed">
          No archived messages. Deleted or expired messages stay here for 7 days
          before Chloromancer removes them permanently.
        </div>
      ) : (
        <div className="admin-comm-list">
          <div className="admin-comm-archive-note">
            Deleted and expired messages remain recoverable here for 7 days before
            Chloromancer purges them permanently.
          </div>
          {archivedMessages.map((item) => (
            <div key={item.id} className={`admin-comm-item is-${item.urgency} is-archived`}>
              <div className="admin-comm-item-main">
                <div className="admin-comm-item-top">
                  <span className="admin-comm-item-title">{item.title}</span>
                  <span
                    className={`admin-comm-pill ${
                      item.status === "deleted" ? "is-deleted" : "is-expired"
                    }`}
                  >
                    {item.status === "deleted" ? "Deleted" : "Expired"}
                  </span>
                  <span className="admin-comm-pill">
                    {formatPlacementLabel(item.placement)}
                  </span>
                  <span className="admin-comm-rev">rev {item.revision}</span>
                </div>
                <div className="admin-comm-item-preview">{item.message}</div>
                <div className="admin-comm-item-dates">
                  {item.deleted_at && (
                    <span>Deleted: {formatDateTimeDisplay(item.deleted_at)}</span>
                  )}
                  {item.expires_at && (
                    <span>Expired: {formatDateTimeDisplay(item.expires_at)}</span>
                  )}
                </div>
              </div>
              <div className="admin-comm-item-actions">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => openEditForm(item)}
                >
                  <RotateCcw size={13} />
                  Edit &amp; Restore
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
