import React, { useState } from "react";
import {
  Check,
  Eye,
  EyeOff,
  Lock,
  Plus,
  Trash2,
  Unlock,
  UserCheck,
  X,
} from "lucide-react";
import { api } from "../api";
import {
  PersonaCreatePayload,
  PersonaItemInstance,
  PersonaLoreEntry,
  PersonaRecord,
} from "../types";
import { TagChipsInput } from "./TagChipsInput";

interface PersonaEditorModalProps {
  persona?: PersonaRecord | null;
  onClose: () => void;
  onSaved: (persona: PersonaRecord) => void;
  onDeleted?: (personaId: string) => void;
}

export const PersonaEditorModal: React.FC<PersonaEditorModalProps> = ({
  persona,
  onClose,
  onSaved,
  onDeleted,
}) => {
  const isDefaultPersona = Boolean(
    persona?.id?.startsWith("persona_default_") || persona?.id === "persona_default_user"
  );
  const [clonedMode, setClonedMode] = useState(false);
  const isReadOnly = isDefaultPersona && !clonedMode;
  const isEditing = Boolean(persona) && !clonedMode;
  const [name, setName] = useState(persona?.name ?? "");
  const [age, setAge] = useState(persona?.age ?? "");
  const [ageIsSecret, setAgeIsSecret] = useState(persona?.age_is_secret ?? true);
  const [physicalAppearance, setPhysicalAppearance] = useState(
    persona?.physical_appearance ?? ""
  );
  const [equipped, setEquipped] = useState<PersonaItemInstance[]>(
    persona?.equipped ? JSON.parse(JSON.stringify(persona.equipped)) : []
  );
  const [inventory, setInventory] = useState<PersonaItemInstance[]>(
    persona?.inventory ? JSON.parse(JSON.stringify(persona.inventory)) : []
  );
  const [loreEntries, setLoreEntries] = useState<PersonaLoreEntry[]>(
    persona?.lore_entries ? JSON.parse(JSON.stringify(persona.lore_entries)) : []
  );

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New item/lore drafting helpers
  const handleAddEquipped = () => {
    const newItem: PersonaItemInstance = {
      id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: "",
      note: "",
      flags: [],
      is_secret: false, // Equipped gear defaults to public
      trigger_keywords: [],
    };
    setEquipped([...equipped, newItem]);
  };

  const handleAddInventory = () => {
    const newItem: PersonaItemInstance = {
      id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: "",
      note: "",
      flags: [],
      is_secret: true, // Inventory carried items default to secret
      trigger_keywords: [],
    };
    setInventory([...inventory, newItem]);
  };

  const handleAddLore = () => {
    const newLore: PersonaLoreEntry = {
      id: `lore_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title: "",
      content: "",
      is_secret: true, // Lore entries default to secret
      trigger_keywords: [],
    };
    setLoreEntries([...loreEntries, newLore]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Persona name is required.");
      return;
    }
    setError(null);
    setSaving(true);

    try {
      // Clean empty items & fill trigger keywords fallback if empty
      const cleanEquipped = equipped
        .filter((it) => it.name.trim())
        .map((it) => ({
          ...it,
          name: it.name.trim(),
          trigger_keywords:
            it.trigger_keywords && it.trigger_keywords.length > 0
              ? it.trigger_keywords
              : [it.name.trim().toLowerCase()],
        }));

      const cleanInventory = inventory
        .filter((it) => it.name.trim())
        .map((it) => ({
          ...it,
          name: it.name.trim(),
          trigger_keywords:
            it.trigger_keywords && it.trigger_keywords.length > 0
              ? it.trigger_keywords
              : [it.name.trim().toLowerCase()],
        }));

      const cleanLore = loreEntries
        .filter((l) => l.title.trim())
        .map((l) => ({
          ...l,
          title: l.title.trim(),
          trigger_keywords:
            l.trigger_keywords && l.trigger_keywords.length > 0
              ? l.trigger_keywords
              : [l.title.trim().toLowerCase()],
        }));

      const payload: PersonaCreatePayload = {
        name: name.trim(),
        age: age.trim() || null,
        age_is_secret: ageIsSecret,
        physical_appearance: physicalAppearance.trim(),
        equipped: cleanEquipped,
        inventory: cleanInventory,
        lore_entries: cleanLore,
      };

      let result: PersonaRecord;
      if (persona?.id && !clonedMode) {
        result = await api.updatePersona(persona.id, payload);
      } else {
        result = await api.createPersona(payload);
      }
      onSaved(result);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to save persona.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!persona?.id || isDefaultPersona) return;
    if (!window.confirm(`Are you sure you want to delete persona "${persona.name}"?`)) {
      return;
    }
    setDeleting(true);
    try {
      await api.deletePersona(persona.id);
      onDeleted?.(persona.id);
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to delete persona.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: 820, width: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <UserCheck size={20} color="var(--accent-emerald)" />
            <h3 style={{ margin: 0 }}>
              {isReadOnly
                ? `Default Persona: ${persona?.name} (Read Only)`
                : clonedMode
                ? "Create Persona (Cloned from Default)"
                : isEditing
                ? `Edit Persona: ${persona?.name}`
                : "Create Player Persona"}
            </h3>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", overflow: "hidden", flex: 1 }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
            {error && (
              <div
                style={{
                  padding: "8px 12px",
                  marginBottom: 16,
                  borderRadius: 6,
                  backgroundColor: "rgba(239, 68, 68, 0.15)",
                  border: "1px solid rgba(239, 68, 68, 0.4)",
                  color: "#fca5a5",
                  fontSize: "0.85rem",
                }}
              >
                {error}
              </div>
            )}

            {/* Header info badge */}
            {isReadOnly ? (
              <div
                style={{
                  marginBottom: 18,
                  padding: "10px 14px",
                  borderRadius: 8,
                  backgroundColor: "rgba(59, 130, 246, 0.08)",
                  border: "1px solid rgba(59, 130, 246, 0.25)",
                  fontSize: "0.82rem",
                  lineHeight: 1.5,
                }}
              >
                <strong>Default Persona:</strong> This is the hard-coded baseline persona with blank attributes named <em>"User"</em>.
                It serves as the default protagonist for all campaigns. To customize your character identity, click <strong>Clone as New Persona</strong> below.
              </div>
            ) : (
              <div
                style={{
                  marginBottom: 18,
                  padding: "10px 14px",
                  borderRadius: 8,
                  backgroundColor: "rgba(16, 185, 129, 0.08)",
                  border: "1px solid rgba(16, 185, 129, 0.25)",
                  fontSize: "0.82rem",
                  lineHeight: 1.5,
                }}
              >
                <strong>Epistemic Persona Profile:</strong> Personas describe your player character during a campaign.
                Immutable anatomy (<strong>Name</strong> and <strong>Physical Appearance</strong>) is permanently public to ensure 100% KV-cache reuse.
                Secrets remain hidden from characters until you reveal them in the scene!
              </div>
            )}

            {/* Section 1: Core Protagonist Identity */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <div className="field-group">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <label style={{ fontWeight: 600 }}>Persona / Protagonist Name *</label>
                  <span
                    style={{
                      fontSize: "0.72rem",
                      padding: "2px 6px",
                      borderRadius: 4,
                      backgroundColor: "rgba(16, 185, 129, 0.2)",
                      color: "var(--accent-emerald)",
                      fontWeight: 600,
                    }}
                  >
                    Always Public
                  </span>
                </div>
                <input
                  type="text"
                  className="field-input"
                  placeholder="e.g. Rachel Thorne"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isReadOnly}
                  required
                />
              </div>

              <div className="field-group">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <label style={{ fontWeight: 600 }}>Age</label>
                  <button
                    type="button"
                    onClick={() => !isReadOnly && setAgeIsSecret(!ageIsSecret)}
                    className="btn"
                    disabled={isReadOnly}
                    style={{
                      padding: "2px 8px",
                      fontSize: "0.72rem",
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      backgroundColor: ageIsSecret ? "rgba(245, 158, 11, 0.15)" : "rgba(16, 185, 129, 0.15)",
                      color: ageIsSecret ? "var(--accent-amber)" : "var(--accent-emerald)",
                      borderColor: ageIsSecret ? "rgba(245, 158, 11, 0.4)" : "rgba(16, 185, 129, 0.4)",
                      opacity: isReadOnly ? 0.6 : 1,
                    }}
                  >
                    {ageIsSecret ? <Lock size={12} /> : <Unlock size={12} />}
                    {ageIsSecret ? "Secret (Locked)" : "Public"}
                  </button>
                </div>
                <input
                  type="text"
                  className="field-input"
                  placeholder="e.g. 29"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  disabled={isReadOnly}
                />
              </div>
            </div>

            {/* Section 2: Physical Appearance */}
            <div className="field-group" style={{ marginBottom: 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <label style={{ fontWeight: 600 }}>Physical Appearance (Visible Anatomy)</label>
                <span
                  style={{
                    fontSize: "0.72rem",
                    padding: "2px 6px",
                    borderRadius: 4,
                    backgroundColor: "rgba(16, 185, 129, 0.2)",
                    color: "var(--accent-emerald)",
                    fontWeight: 600,
                  }}
                >
                  Always Public
                </span>
              </div>
              <textarea
                className="field-input"
                rows={3}
                placeholder="Visible bodily traits: height, build, hair, facial features, cybernetic optics, scars..."
                value={physicalAppearance}
                onChange={(e) => setPhysicalAppearance(e.target.value)}
                disabled={isReadOnly}
              />
            </div>

            {/* Section 3: Equipped Attire & Gear */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: "0.95rem" }}>Equipped Attire & Visible Gear</h4>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Outer garments, holstered weapons, visible gear (Default: Public).
                  </span>
                </div>
                {!isReadOnly && (
                  <button type="button" className="btn btn-sm" onClick={handleAddEquipped}>
                    <Plus size={14} /> Add Equipped Item
                  </button>
                )}
              </div>

              {equipped.length === 0 ? (
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontStyle: "italic", padding: "8px 0" }}>
                  No equipped items specified.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {equipped.map((it, idx) => (
                    <div
                      key={it.id || idx}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 6,
                        backgroundColor: "var(--bg-secondary)",
                        border: "1px solid var(--border-color)",
                      }}
                    >
                      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
                        <input
                          type="text"
                          className="field-input"
                          style={{ flex: 1 }}
                          placeholder="Item name (e.g. Armored Leather Duster)"
                          value={it.name}
                          onChange={(e) => {
                            const next = [...equipped];
                            next[idx].name = e.target.value;
                            setEquipped(next);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const next = [...equipped];
                            next[idx].is_secret = !next[idx].is_secret;
                            setEquipped(next);
                          }}
                          className="btn btn-sm"
                          style={{
                            color: it.is_secret ? "var(--accent-amber)" : "var(--accent-emerald)",
                          }}
                        >
                          {it.is_secret ? <EyeOff size={13} /> : <Eye size={13} />}
                          {it.is_secret ? "Secret" : "Public"}
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          style={{ color: "var(--accent-rose)" }}
                          onClick={() => setEquipped(equipped.filter((_, i) => i !== idx))}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                      <input
                        type="text"
                        className="field-input"
                        placeholder="Sensory note or visual detail (e.g. ballistic weave lining)"
                        value={it.note}
                        onChange={(e) => {
                          const next = [...equipped];
                          next[idx].note = e.target.value;
                          setEquipped(next);
                        }}
                        style={{ marginBottom: it.is_secret ? 8 : 0 }}
                      />
                      {it.is_secret && (
                        <div style={{ marginTop: 8 }}>
                          <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: 3 }}>
                            Trigger Keywords to Reveal (comma-separated):
                          </label>
                          <TagChipsInput
                            value={it.trigger_keywords || []}
                            onChange={(tags) => {
                              const next = [...equipped];
                              next[idx].trigger_keywords = tags;
                              setEquipped(next);
                            }}
                            placeholder="Add trigger keyword (e.g. duster, coat)..."
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Section 4: Carried Inventory */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: "0.95rem" }}>Carried Inventory</h4>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Concealed items, cyberdeck tools, contraband (Default: Secret, revealed upon trigger keyword).
                  </span>
                </div>
                {!isReadOnly && (
                  <button type="button" className="btn btn-sm" onClick={handleAddInventory}>
                    <Plus size={14} /> Add Inventory Item
                  </button>
                )}
              </div>

              {inventory.length === 0 ? (
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontStyle: "italic", padding: "8px 0" }}>
                  No carried inventory items specified.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {inventory.map((it, idx) => (
                    <div
                      key={it.id || idx}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 6,
                        backgroundColor: "var(--bg-secondary)",
                        border: "1px solid var(--border-color)",
                      }}
                    >
                      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
                        <input
                          type="text"
                          className="field-input"
                          style={{ flex: 1 }}
                          placeholder="Item name (e.g. Counterfeit Access Keycard)"
                          value={it.name}
                          onChange={(e) => {
                            const next = [...inventory];
                            next[idx].name = e.target.value;
                            setInventory(next);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const next = [...inventory];
                            next[idx].is_secret = !next[idx].is_secret;
                            setInventory(next);
                          }}
                          className="btn btn-sm"
                          style={{
                            color: it.is_secret ? "var(--accent-amber)" : "var(--accent-emerald)",
                          }}
                        >
                          {it.is_secret ? <EyeOff size={13} /> : <Eye size={13} />}
                          {it.is_secret ? "Secret" : "Public"}
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          style={{ color: "var(--accent-rose)" }}
                          onClick={() => setInventory(inventory.filter((_, i) => i !== idx))}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                      <input
                        type="text"
                        className="field-input"
                        placeholder="Sensory note or function (e.g. spoofed credentials for Sector 4)"
                        value={it.note}
                        onChange={(e) => {
                          const next = [...inventory];
                          next[idx].note = e.target.value;
                          setInventory(next);
                        }}
                        style={{ marginBottom: it.is_secret ? 8 : 0 }}
                      />
                      {it.is_secret && (
                        <div style={{ marginTop: 8 }}>
                          <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: 3 }}>
                            Trigger Keywords to Reveal (comma-separated):
                          </label>
                          <TagChipsInput
                            value={it.trigger_keywords || []}
                            onChange={(tags) => {
                              const next = [...inventory];
                              next[idx].trigger_keywords = tags;
                              setInventory(next);
                            }}
                            placeholder="Add trigger keyword (e.g. keycard, pass, badge)..."
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Section 5: Lore Entries */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div>
                  <h4 style={{ margin: 0, fontSize: "0.95rem" }}>Lore Entries & Backstory Secrets</h4>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    Secret background facets revealed only when triggered in dialogue (Default: Secret).
                  </span>
                </div>
                {!isReadOnly && (
                  <button type="button" className="btn btn-sm" onClick={handleAddLore}>
                    <Plus size={14} /> Add Lore Entry
                  </button>
                )}
              </div>

              {loreEntries.length === 0 ? (
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontStyle: "italic", padding: "8px 0" }}>
                  No lore entries specified.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {loreEntries.map((l, idx) => (
                    <div
                      key={l.id || idx}
                      style={{
                        padding: "12px 14px",
                        borderRadius: 6,
                        backgroundColor: "var(--bg-secondary)",
                        border: "1px solid var(--border-color)",
                      }}
                    >
                      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
                        <input
                          type="text"
                          className="field-input"
                          style={{ flex: 1 }}
                          placeholder="Secret Title (e.g. Ex-Corpo Intelligence Operative)"
                          value={l.title}
                          onChange={(e) => {
                            const next = [...loreEntries];
                            next[idx].title = e.target.value;
                            setLoreEntries(next);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const next = [...loreEntries];
                            next[idx].is_secret = !next[idx].is_secret;
                            setLoreEntries(next);
                          }}
                          className="btn btn-sm"
                          style={{
                            color: l.is_secret ? "var(--accent-amber)" : "var(--accent-emerald)",
                          }}
                        >
                          {l.is_secret ? <EyeOff size={13} /> : <Eye size={13} />}
                          {l.is_secret ? "Secret" : "Public"}
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          style={{ color: "var(--accent-rose)" }}
                          onClick={() => setLoreEntries(loreEntries.filter((_, i) => i !== idx))}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                      <textarea
                        className="field-input"
                        rows={2}
                        placeholder="Content of the secret or lore entry..."
                        value={l.content}
                        onChange={(e) => {
                          const next = [...loreEntries];
                          next[idx].content = e.target.value;
                          setLoreEntries(next);
                        }}
                        style={{ marginBottom: l.is_secret ? 8 : 0 }}
                      />
                      {l.is_secret && (
                        <div style={{ marginTop: 8 }}>
                          <label style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", marginBottom: 3 }}>
                            Trigger Keywords to Reveal (comma-separated):
                          </label>
                          <TagChipsInput
                            value={l.trigger_keywords || []}
                            onChange={(tags) => {
                              const next = [...loreEntries];
                              next[idx].trigger_keywords = tags;
                              setLoreEntries(next);
                            }}
                            placeholder="Add trigger keyword (e.g. araska, corporate, operative)..."
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div
            className="modal-footer"
            style={{
              padding: "12px 20px",
              borderTop: "1px solid var(--border-color)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              {isEditing && !isDefaultPersona && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-rose"
                  style={{ color: "var(--accent-rose)" }}
                  onClick={handleDelete}
                  disabled={deleting || saving}
                >
                  <Trash2 size={14} /> {deleting ? "Deleting..." : "Delete Persona"}
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" className="btn" onClick={onClose} disabled={saving || deleting}>
                {isReadOnly ? "Close" : "Cancel"}
              </button>
              {isReadOnly ? (
                <button
                  type="button"
                  className="btn btn-emerald"
                  onClick={() => {
                    setClonedMode(true);
                    setName("User (Custom)");
                  }}
                >
                  <Plus size={15} /> Clone as New Persona
                </button>
              ) : (
                <button
                  type="submit"
                  className="btn btn-emerald"
                  disabled={saving || deleting || !name.trim()}
                >
                  <Check size={15} />
                  {saving ? "Saving..." : isEditing ? "Save Changes" : "Create Persona"}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
