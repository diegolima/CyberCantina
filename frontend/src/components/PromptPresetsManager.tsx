import React, { useEffect, useState } from "react";
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
  const [saving, setSaving] = useState(false);
  const [activeIdState, setActiveIdState] = useState<string | null>(activePresetId ?? null);
  const [selectedId, setSelectedId] = useState<string>("builtin-default");
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({
    actor_zone1_system: true,
  });
  const [editingPrompts, setEditingPrompts] = useState<Record<string, string>>({});
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Clone / Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [newPresetDesc, setNewPresetDesc] = useState("");
  const [createAsActive, setCreateAsActive] = useState(true);

  useEffect(() => {
    if (activePresetId !== undefined) {
      setActiveIdState(activePresetId);
    }
  }, [activePresetId]);

  const loadData = async (preferredId?: string) => {
    setLoading(true);
    try {
      const resp = await api.getPromptDefaults();
      setData(resp);
      const serverActive = activePresetId !== undefined ? activePresetId : (resp.active_preset_id ?? null);
      setActiveIdState(serverActive);

      setSelectedId((prevSelectedId) => {
        const candidate = preferredId ?? prevSelectedId;
        if (candidate && resp.presets.some((p) => p.id === candidate)) {
          return candidate;
        }
        if (serverActive && resp.presets.some((p) => p.id === serverActive)) {
          return serverActive;
        }
        return resp.presets[0]?.id || "builtin-default";
      });
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to load prompt presets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

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
  const effectiveActiveId = activePresetId !== undefined ? activePresetId : activeIdState;
  const isActive = (effectiveActiveId || "builtin-default") === selectedId;

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handlePromptChange = (key: string, val: string) => {
    setEditingPrompts((prev) => ({ ...prev, [key]: val }));
  };

  const handleSavePresetPrompts = async (alsoActivate: boolean = false) => {
    if (!currentPreset || currentPreset.is_builtin) return;
    setSaving(true);
    setErrorMsg("");
    try {
      await api.updatePromptPreset(selectedId, {
        prompts: editingPrompts,
      });
      if (alsoActivate) {
        const targetId = selectedId === "builtin-default" ? null : selectedId;
        if (onActivePresetChanged) {
          await onActivePresetChanged(targetId);
        } else {
          await api.setActivePromptPreset(targetId);
        }
        setActiveIdState(targetId);
        setStatusMsg(`Preset "${currentPreset.name}" saved and set as active.`);
      } else {
        setStatusMsg("Prompt preset saved successfully.");
      }
      await loadData(selectedId);
      setTimeout(() => setStatusMsg(""), 3500);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save prompt preset");
    } finally {
      setSaving(false);
    }
  };

  const handleResetToDefault = async () => {
    if (!currentPreset) return;
    if (
      !confirm(
        `Reset all prompts in preset "${currentPreset.name}" back to the factory defaults?`
      )
    ) {
      return;
    }
    setSaving(true);
    setErrorMsg("");
    try {
      const res = await api.resetPromptPreset(selectedId);
      setEditingPrompts({ ...res.prompts });
      await loadData(selectedId);
      setStatusMsg("Preset prompts have been reset to factory defaults.");
      setTimeout(() => setStatusMsg(""), 3500);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to reset preset");
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePreset = async () => {
    if (!currentPreset || currentPreset.is_builtin) return;
    if (!confirm(`Delete custom prompt preset "${currentPreset.name}"?`)) {
      return;
    }
    setSaving(true);
    setErrorMsg("");
    try {
      await api.deletePromptPreset(selectedId);
      if (effectiveActiveId === selectedId) {
        if (onActivePresetChanged) {
          await onActivePresetChanged(null);
        } else {
          await api.setActivePromptPreset(null);
        }
        setActiveIdState(null);
      }
      await loadData("builtin-default");
      setSelectedId("builtin-default");
      setStatusMsg("Preset deleted.");
      setTimeout(() => setStatusMsg(""), 3500);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to delete preset");
    } finally {
      setSaving(false);
    }
  };

  const handleCreatePreset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPresetName.trim()) return;
    setSaving(true);
    setErrorMsg("");
    try {
      const created = await api.createPromptPreset({
        name: newPresetName.trim(),
        description: newPresetDesc.trim(),
        base_preset_id: selectedId,
      });
      if (createAsActive) {
        if (onActivePresetChanged) {
          await onActivePresetChanged(created.id);
        } else {
          await api.setActivePromptPreset(created.id);
        }
        setActiveIdState(created.id);
      }
      setShowCreateModal(false);
      setNewPresetName("");
      setNewPresetDesc("");
      await loadData(created.id);
      setSelectedId(created.id);
      setStatusMsg(
        `Preset "${created.name}" created${createAsActive ? " and set as active" : ""}.`
      );
      setTimeout(() => setStatusMsg(""), 3500);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to create preset");
    } finally {
      setSaving(false);
    }
  };

  const handleSetActive = async () => {
    if (!currentPreset) return;
    setSaving(true);
    setErrorMsg("");
    try {
      const targetId = selectedId === "builtin-default" ? null : selectedId;
      if (onActivePresetChanged) {
        await onActivePresetChanged(targetId);
      } else {
        await api.setActivePromptPreset(targetId);
      }
      setActiveIdState(targetId);
      setStatusMsg(`Preset "${currentPreset.name}" is now active.`);
      setTimeout(() => setStatusMsg(""), 3500);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to set active preset");
    } finally {
      setSaving(false);
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
          borderRadius: 8,
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
                  {(effectiveActiveId || "builtin-default") === preset.id ? " ★ Active" : ""}
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
              disabled={saving || isActive}
            >
              {isActive ? "✓ Currently Active" : "Set as Active Preset"}
            </button>

            {!isBuiltin && (
              <>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: "8px 12px", fontSize: "0.82rem", color: "var(--text-secondary)" }}
                  title="Reset this preset's templates to default"
                  onClick={handleResetToDefault}
                  disabled={saving}
                >
                  <RotateCcw size={14} />
                  Reset
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: "8px 12px", fontSize: "0.82rem", color: "var(--accent-rose)" }}
                  title="Delete preset"
                  onClick={handleDeletePreset}
                  disabled={saving}
                >
                  <Trash2 size={14} />
                </button>
              </>
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

      {/* Prompts Accordion List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {data?.metadata.map((meta) => {
          const isExpanded = !!expandedKeys[meta.key];
          const templateVal =
            editingPrompts[meta.key] ?? currentPreset?.prompts[meta.key] ?? data.defaults[meta.key] ?? "";
          const hasMissingTag = meta.required_tags.some((t) => !templateVal.includes(t));

          return (
            <div
              key={meta.key}
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                overflow: "hidden",
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
                    <div style={{ fontWeight: 600, fontSize: "0.88rem", color: "var(--text-primary)" }}>
                      {meta.title}
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
                <div style={{ padding: "12px 16px 16px", borderTop: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 10 }}>
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
                    disabled={isBuiltin || saving}
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
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Save Action for Custom Presets */}
      {!isBuiltin && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
          {!isActive ? (
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => handleSavePresetPrompts(false)}
                disabled={saving}
                style={{ padding: "8px 16px" }}
              >
                <span>Save Changes</span>
              </button>
              <button
                type="button"
                className="btn btn-amber"
                onClick={() => handleSavePresetPrompts(true)}
                disabled={saving}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 18px" }}
              >
                <Check size={14} />
                <span>{saving ? "Saving..." : "Save & Set as Active Preset"}</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-amber"
              onClick={() => handleSavePresetPrompts(true)}
              disabled={saving}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 18px" }}
            >
              <Check size={14} />
              <span>{saving ? "Saving..." : "Save Custom Preset Changes"}</span>
            </button>
          )}
        </div>
      )}

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

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.82rem", cursor: "pointer", color: "var(--text-secondary)" }}>
                <input
                  type="checkbox"
                  checked={createAsActive}
                  onChange={(e) => setCreateAsActive(e.target.checked)}
                />
                <span>Set as active roleplay preset immediately</span>
              </label>

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
                  disabled={saving || !newPresetName.trim()}
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
