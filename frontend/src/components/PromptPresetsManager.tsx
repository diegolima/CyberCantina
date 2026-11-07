import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { api } from "../api";
import {
  PromptDefaultsResponse,
  PromptPresetRecord,
} from "../types";
import {
  PROMPT_ROLES,
  PromptRoleId,
  getRoleForPromptKey,
} from "./prompts/promptRoleDefinitions";
import { PromptRoleDeck, RoleStats } from "./prompts/PromptRoleDeck";

interface PromptPresetsManagerProps {
  activePresetId?: string | null;
  onActivePresetChanged?: (presetId: string | null) => Promise<void>;
}

export const PromptPresetsManager: React.FC<PromptPresetsManagerProps> = ({
  activePresetId,
  onActivePresetChanged,
}) => {
  const [data, setData] = useState<PromptDefaultsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("builtin-default");
  const [currentActivePresetId, setCurrentActivePresetId] = useState<string | null>(
    activePresetId ?? null
  );
  const [selectedRoleId, setSelectedRoleId] = useState<PromptRoleId>("storytelling");
  // Default to all collapsed
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});
  const [editingPrompts, setEditingPrompts] = useState<Record<string, string>>({});
  const [savingKeys, setSavingKeys] = useState<Record<string, boolean>>({});
  const [savedNoticeKeys, setSavedNoticeKeys] = useState<Record<string, boolean>>({});
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Clone / Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [newPresetDesc, setNewPresetDesc] = useState("");

  const loadData = async () => {
    setLoading(true);
    try {
      const resp = await api.getPromptDefaults();
      setData(resp);

      // Determine active preset id from prop or backend response
      const effectiveActive =
        activePresetId !== undefined ? activePresetId : (resp.active_preset_id ?? null);
      setCurrentActivePresetId(effectiveActive);

      // Initial selected preset: active preset if valid, else first preset
      const initialId =
        effectiveActive && resp.presets.some((p) => p.id === effectiveActive)
          ? effectiveActive
          : resp.presets[0]?.id || "builtin-default";
      setSelectedId(initialId);

      const sel = resp.presets.find((p) => p.id === initialId) || resp.presets[0];
      if (sel) {
        setEditingPrompts({ ...sel.prompts });
      }
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to load prompt presets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Sync if parent updates activePresetId prop
  useEffect(() => {
    if (activePresetId !== undefined) {
      setCurrentActivePresetId(activePresetId);
    }
  }, [activePresetId]);

  useEffect(() => {
    if (data) {
      const sel = data.presets.find((p) => p.id === selectedId);
      if (sel) {
        setEditingPrompts({ ...sel.prompts });
      }
    }
  }, [selectedId, data]);

  const currentPreset: PromptPresetRecord | undefined = data?.presets.find(
    (p) => p.id === selectedId
  );
  const isBuiltin = currentPreset?.is_builtin ?? false;
  const effectiveActiveId = currentActivePresetId || "builtin-default";
  const isActive = effectiveActiveId === selectedId;

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handlePromptChange = (key: string, val: string) => {
    setEditingPrompts((prev) => ({ ...prev, [key]: val }));
  };

  // Compute aggregate stats per role
  const roleStats: Record<PromptRoleId, RoleStats> = useMemo(() => {
    const initial: Record<PromptRoleId, RoleStats> = {
      storytelling: { promptCount: 0, missingTokenCount: 0, unsavedCount: 0 },
      cognition: { promptCount: 0, missingTokenCount: 0, unsavedCount: 0 },
      auxiliary: { promptCount: 0, missingTokenCount: 0, unsavedCount: 0 },
      wizard: { promptCount: 0, missingTokenCount: 0, unsavedCount: 0 },
    };

    if (!data) return initial;

    for (const meta of data.metadata) {
      const roleId = getRoleForPromptKey(meta.key);
      const templateVal =
        editingPrompts[meta.key] ?? currentPreset?.prompts[meta.key] ?? data.defaults[meta.key] ?? "";
      const savedVal = currentPreset?.prompts[meta.key] ?? data.defaults[meta.key] ?? "";
      const hasMissingTag = meta.required_tags.some((t) => !templateVal.includes(t));
      const isDirty = !isBuiltin && (templateVal !== savedVal);

      if (initial[roleId]) {
        initial[roleId].promptCount += 1;
        if (hasMissingTag) {
          initial[roleId].missingTokenCount += 1;
        }
        if (isDirty) {
          initial[roleId].unsavedCount += 1;
        }
      }
    }

    return initial;
  }, [data, editingPrompts, currentPreset, isBuiltin]);

  // Active Role and Filtered Prompts
  const activeRole = useMemo(() => {
    return PROMPT_ROLES.find((r) => r.id === selectedRoleId) || PROMPT_ROLES[0];
  }, [selectedRoleId]);

  const filteredPrompts = useMemo(() => {
    if (!data) return [];
    return data.metadata.filter((meta) => activeRole.promptKeys.includes(meta.key));
  }, [data, activeRole]);

  const handleSelectRole = (roleId: PromptRoleId) => {
    setSelectedRoleId(roleId);
  };

  // Per-prompt save & discard handlers
  const handleSavePrompt = async (key: string) => {
    if (!currentPreset || currentPreset.is_builtin) return;
    const templateVal =
      editingPrompts[key] ?? currentPreset.prompts[key] ?? data?.defaults[key] ?? "";
    setSavingKeys((prev) => ({ ...prev, [key]: true }));
    setErrorMsg("");
    try {
      await api.updatePromptPreset(selectedId, {
        prompts: { [key]: templateVal },
      });
      await loadData();
      setSavedNoticeKeys((prev) => ({ ...prev, [key]: true }));
      setTimeout(() => {
        setSavedNoticeKeys((prev) => ({ ...prev, [key]: false }));
      }, 2500);
    } catch (err: any) {
      setErrorMsg(err.message || `Failed to save prompt "${key}"`);
    } finally {
      setSavingKeys((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleDiscardPrompt = (key: string) => {
    const savedVal = currentPreset?.prompts[key] ?? data?.defaults[key] ?? "";
    setEditingPrompts((prev) => ({ ...prev, [key]: savedVal }));
  };

  const handleDeletePreset = async () => {
    if (!currentPreset || currentPreset.is_builtin) return;
    if (!confirm(`Delete custom prompt preset "${currentPreset.name}"?`)) {
      return;
    }
    setSavingPreset(true);
    setErrorMsg("");
    try {
      await api.deletePromptPreset(selectedId);
      await loadData();
      setSelectedId("builtin-default");
      setStatusMsg("Preset deleted.");
      setTimeout(() => setStatusMsg(""), 3500);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to delete preset");
    } finally {
      setSavingPreset(false);
    }
  };

  const handleCreatePreset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPresetName.trim()) return;
    setSavingPreset(true);
    setErrorMsg("");
    try {
      const created = await api.createPromptPreset({
        name: newPresetName.trim(),
        description: newPresetDesc.trim(),
        base_preset_id: selectedId,
      });
      setShowCreateModal(false);
      setNewPresetName("");
      setNewPresetDesc("");
      await loadData();
      setSelectedId(created.id);
      setStatusMsg(`Preset "${created.name}" created.`);
      setTimeout(() => setStatusMsg(""), 3500);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to create preset");
    } finally {
      setSavingPreset(false);
    }
  };

  const handleSetActive = async () => {
    setSavingPreset(true);
    setErrorMsg("");
    const targetId = selectedId === "builtin-default" ? null : selectedId;
    try {
      if (onActivePresetChanged) {
        await onActivePresetChanged(targetId);
      } else {
        await api.setActivePromptPreset(targetId);
      }
      setCurrentActivePresetId(targetId);
      setStatusMsg(`Preset "${currentPreset?.name}" is now active.`);
      setTimeout(() => setStatusMsg(""), 3500);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to set active preset");
    } finally {
      setSavingPreset(false);
    }
  };

  if (loading && !data) {
    return (
      <div style={{ padding: "32px 0", textAlign: "center", color: "var(--text-secondary)" }}>
        Loading prompt presets and documentation...
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Alert Messages */}
      {statusMsg && (
        <div className="auth-alert auth-alert-success" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Check size={16} />
          <span>{statusMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="auth-alert auth-alert-error" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={16} />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Preset Toolbar */}
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 10,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Sparkles size={18} style={{ color: "var(--accent-amber)" }} />
            <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>Prompt Presets Store</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: "6px 12px", fontSize: "0.82rem", display: "flex", alignItems: "center", gap: 6 }}
              onClick={() => {
                setNewPresetName(`Copy of ${currentPreset?.name || "Preset"}`);
                setNewPresetDesc(currentPreset?.description || "");
                setShowCreateModal(true);
              }}
            >
              <Plus size={14} />
              Clone / New Preset
            </button>
          </div>
        </div>

        {/* Preset Selector & Action Badges */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.78rem", color: "var(--text-secondary)", marginBottom: 4 }}>
              Selected Preset:
            </label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              style={{
                width: "100%",
                background: "var(--bg-panel)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 6,
                padding: "8px 12px",
                color: "var(--text-primary)",
                fontSize: "0.9rem",
              }}
            >
              {data?.presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name} {preset.is_builtin ? "(Built-in)" : "(Custom)"}
                  {effectiveActiveId === preset.id ? " ★ Active" : ""}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: "100%" }}>
            <button
              type="button"
              className={`btn ${isActive ? "btn-secondary" : "btn-amber"}`}
              style={{ padding: "8px 14px", fontSize: "0.82rem", whiteSpace: "nowrap" }}
              onClick={handleSetActive}
              disabled={savingPreset || isActive}
            >
              {isActive ? "✓ Currently Active" : "Set as Active Preset"}
            </button>

            {!isBuiltin && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: "8px 12px", fontSize: "0.82rem", color: "var(--accent-rose)" }}
                title="Delete preset"
                onClick={handleDeletePreset}
                disabled={savingPreset}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Preset Description & Tag */}
        {currentPreset && (
          <div style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginTop: 2 }}>
            <span style={{ fontWeight: 500, color: "var(--text-primary)" }}>{currentPreset.name}:</span>{" "}
            {currentPreset.description || "No description provided."}
            {isBuiltin && (
              <span
                style={{
                  marginLeft: 8,
                  padding: "2px 8px",
                  borderRadius: 4,
                  fontSize: "0.72rem",
                  background: "rgba(6, 182, 212, 0.15)",
                  color: "var(--accent-cyan)",
                  border: "1px solid rgba(6, 182, 212, 0.3)",
                }}
              >
                Read-Only Built-in (Clone to Edit)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Role Deck (Card Selector) with Descriptions in Hover Tooltips */}
      <PromptRoleDeck
        selectedRoleId={selectedRoleId}
        onSelectRole={handleSelectRole}
        stats={roleStats}
      />

      {/* Filtered Prompts Accordion List (Flows Directly Under Deck) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {filteredPrompts.map((meta) => {
          const isExpanded = !!expandedKeys[meta.key];
          const templateVal =
            editingPrompts[meta.key] ?? currentPreset?.prompts[meta.key] ?? data?.defaults[meta.key] ?? "";
          const savedVal = currentPreset?.prompts[meta.key] ?? data?.defaults[meta.key] ?? "";
          const hasMissingTag = meta.required_tags.some((t) => !templateVal.includes(t));
          const isDirty = !isBuiltin && (templateVal !== savedVal);
          const isSavingThis = !!savingKeys[meta.key];
          const justSavedThis = !!savedNoticeKeys[meta.key];

          return (
            <div
              key={meta.key}
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                overflow: "hidden",
                transition: "border-color 0.2s ease",
              }}
            >
              {/* Accordion Header */}
              <div
                onClick={() => toggleExpand(meta.key)}
                style={{
                  padding: "12px 16px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: isExpanded ? "rgba(255, 255, 255, 0.02)" : "transparent",
                  userSelect: "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <FileText size={16} style={{ color: "var(--text-secondary)" }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.88rem", color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 8 }}>
                      <span>{meta.title}</span>

                      {/* Dirty State / Unsaved Edits Badge */}
                      {isDirty && (
                        <span className="prompt-unsaved-badge" title="This prompt has unsaved changes">
                          Unsaved edits
                        </span>
                      )}

                      {/* Just Saved Success Indicator */}
                      {justSavedThis && (
                        <span className="prompt-saved-badge" title="Changes saved successfully">
                          <Check size={12} /> Saved
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: "0.76rem", color: "var(--text-muted)" }}>
                      Key: <code>{meta.key}</code>
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {hasMissingTag && (
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: "0.72rem",
                        padding: "2px 8px",
                        background: "rgba(244, 63, 94, 0.15)",
                        color: "var(--accent-rose)",
                        borderRadius: 4,
                      }}
                    >
                      <AlertTriangle size={12} />
                      Missing required token
                    </span>
                  )}
                  {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>
              </div>

              {/* Accordion Body */}
              {isExpanded && (
                <div
                  style={{
                    padding: "12px 16px 16px",
                    borderTop: "1px solid var(--border-subtle)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                    {meta.description}
                  </p>

                  {/* Available Placeholders */}
                  {meta.available_variables.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontSize: "0.74rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase" }}>
                        Available Placeholders:
                      </span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {meta.available_variables.map((v) => (
                          <span
                            key={v.name}
                            title={v.description}
                            style={{
                              fontSize: "0.75rem",
                              fontFamily: "monospace",
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: "rgba(255, 255, 255, 0.05)",
                              border: "1px solid var(--border-subtle)",
                              color: "var(--accent-amber)",
                            }}
                          >
                            {"{" + v.name + "}"}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Warning if missing token */}
                  {hasMissingTag && (
                    <div
                      style={{
                        padding: "8px 12px",
                        borderRadius: 6,
                        background: "rgba(244, 63, 94, 0.1)",
                        border: "1px solid rgba(244, 63, 94, 0.25)",
                        fontSize: "0.78rem",
                        color: "var(--accent-rose)",
                      }}
                    >
                      Warning: Missing recommended token(s):{" "}
                      <code>{meta.required_tags.join(", ")}</code>. The output parser expects these XML or schema markers.
                    </div>
                  )}

                  {/* Prompt Textarea */}
                  <textarea
                    value={templateVal}
                    onChange={(e) => handlePromptChange(meta.key, e.target.value)}
                    disabled={isBuiltin || isSavingThis}
                    rows={8}
                    style={{
                      width: "100%",
                      fontFamily: "monospace",
                      fontSize: "0.82rem",
                      background: isBuiltin ? "rgba(0, 0, 0, 0.25)" : "var(--bg-panel)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 6,
                      padding: 10,
                      color: "var(--text-primary)",
                      resize: "vertical",
                      lineHeight: 1.45,
                      opacity: isBuiltin ? 0.85 : 1,
                    }}
                  />

                  {/* Inline Per-Prompt Action Micro-Bar for Custom Presets */}
                  {!isBuiltin && isDirty && (
                    <div className="prompt-editor-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => handleDiscardPrompt(meta.key)}
                        disabled={isSavingThis}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: "0.80rem",
                          padding: "6px 12px",
                          color: "var(--text-secondary)",
                        }}
                      >
                        <RotateCcw size={13} />
                        <span>Discard</span>
                      </button>
                      <button
                        type="button"
                        className="btn btn-amber"
                        onClick={() => handleSavePrompt(meta.key)}
                        disabled={isSavingThis}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          fontSize: "0.80rem",
                          padding: "6px 14px",
                        }}
                      >
                        <Check size={13} />
                        <span>{isSavingThis ? "Saving..." : "Save changes"}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Create / Clone Modal */}
      {showCreateModal && (
        <div
          className="modal-overlay"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            className="modal-card"
            style={{
              background: "var(--bg-panel)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 10,
              padding: 24,
              width: "100%",
              maxWidth: 480,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 700 }}>Clone / New Prompt Preset</h3>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowCreateModal(false)}
                style={{ padding: 4 }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreatePreset} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: 4 }}>
                  Preset Name:
                </label>
                <input
                  type="text"
                  required
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  placeholder="e.g. Gritty Noir Dialogue"
                  style={{
                    width: "100%",
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 6,
                    padding: "8px 12px",
                    color: "var(--text-primary)",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: 4 }}>
                  Description:
                </label>
                <input
                  type="text"
                  value={newPresetDesc}
                  onChange={(e) => setNewPresetDesc(e.target.value)}
                  placeholder="Optional notes about what this preset is tuned for"
                  style={{
                    width: "100%",
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 6,
                    padding: "8px 12px",
                    color: "var(--text-primary)",
                  }}
                />
              </div>

              <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                Initial templates will be cloned from <strong>{currentPreset?.name}</strong>.
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-amber"
                  disabled={savingPreset || !newPresetName.trim()}
                >
                  Create Preset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
