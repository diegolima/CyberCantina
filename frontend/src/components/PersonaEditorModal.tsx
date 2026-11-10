import React, { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  FileText,
  Lock,
  Package,
  Plus,
  Trash2,
  User,
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

export type PersonaTab = "base" | "appearance" | "lore" | "inventory";

interface PersonaEditorModalProps {
  persona?: PersonaRecord | null;
  isDefault?: boolean;
  onClose: () => void;
  onSaved: (persona: PersonaRecord) => void;
  onDeleted?: (personaId: string) => Promise<void> | void;
  onSetDefault?: (persona: PersonaRecord) => void;
}

export const PersonaEditorModal: React.FC<PersonaEditorModalProps> = ({
  persona,
  isDefault = false,
  onClose,
  onSaved,
  onDeleted,
  onSetDefault,
}) => {
  const isDefaultPersonaRecord = Boolean(
    persona?.id?.startsWith("persona_default_") || persona?.id === "persona_default_user"
  );
  const [clonedMode, setClonedMode] = useState(false);
  const isReadOnly = isDefaultPersonaRecord && !clonedMode;
  const isEditing = Boolean(persona) && !clonedMode;

  const [activeTab, setActiveTab] = useState<PersonaTab>("base");

  // Base Tab Fields
  const [name, setName] = useState(persona?.name ?? "");
  const [species, setSpecies] = useState(persona?.species ?? "Human");
  const [age, setAge] = useState(persona?.age ?? "");
  const [ageIsSecret, setAgeIsSecret] = useState(persona?.age_is_secret ?? true);
  const [sex, setSex] = useState(persona?.sex ?? "");
  const [pronouns, setPronouns] = useState(persona?.pronouns ?? "");
  const [personaBio, setPersonaBio] = useState(persona?.persona_bio ?? "");
  const [tags, setTags] = useState<string[]>(persona?.tags ?? []);

  // Appearance Tab Fields
  const [buildAndHeight, setBuildAndHeight] = useState(
    persona?.build_and_height ?? ""
  );
  const [distinctiveFeatures, setDistinctiveFeatures] = useState<string[]>(
    persona?.distinctive_features ?? []
  );

  // Lore / Secrets Tab Fields
  const [loreEntries, setLoreEntries] = useState<PersonaLoreEntry[]>(
    persona?.lore_entries ? JSON.parse(JSON.stringify(persona.lore_entries)) : []
  );

  // Inventory Tab Fields
  const [equipped, setEquipped] = useState<PersonaItemInstance[]>(
    persona?.equipped ? JSON.parse(JSON.stringify(persona.equipped)) : []
  );
  const [inventory, setInventory] = useState<PersonaItemInstance[]>(
    persona?.inventory ? JSON.parse(JSON.stringify(persona.inventory)) : []
  );
  const [expandedItemKey, setExpandedItemKey] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shortcut pills for quick demographic selection
  const speciesShortcuts = ["Human", "Cyborg", "Android", "Replicant", "Elf", "Synth"];
  const ageShortcuts = ["Unknown", "Ageless", "Early 20s", "Mid 30s"];
  const sexShortcuts = ["Male", "Female", "Non-binary", "Other"];
  const pronounShortcuts = ["he/him", "she/her", "they/them", "it/its"];

  // Item & Lore helpers
  const handleAddEquipped = () => {
    const newItem: PersonaItemInstance = {
      id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: "",
      note: "",
      flags: [],
      is_secret: false, // Equipped attire defaults to public
      trigger_keywords: [],
    };
    setEquipped([...equipped, newItem]);
    setExpandedItemKey(`eq:${newItem.id}`);
  };

  const handleAddInventory = () => {
    const newItem: PersonaItemInstance = {
      id: `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: "",
      note: "",
      flags: [],
      is_secret: true, // Carried inventory defaults to secret
      trigger_keywords: [],
    };
    setInventory([...inventory, newItem]);
    setExpandedItemKey(`inv:${newItem.id}`);
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
      setActiveTab("base");
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
          note: (it.note || "").trim().slice(0, 300),
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
          note: (it.note || "").trim().slice(0, 300),
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
          content: l.content.trim(),
          trigger_keywords:
            l.trigger_keywords && l.trigger_keywords.length > 0
              ? l.trigger_keywords
              : [l.title.trim().toLowerCase()],
        }));

      const payload: PersonaCreatePayload = {
        name: name.trim(),
        species: species.trim() || "Human",
        age: age.trim() || null,
        age_is_secret: ageIsSecret,
        sex: sex.trim(),
        pronouns: pronouns.trim(),
        persona_bio: personaBio.trim(),
        tags: tags.map((t) => t.trim()).filter(Boolean),
        build_and_height: buildAndHeight.trim(),
        distinctive_features: distinctiveFeatures.map((f) => f.trim()).filter(Boolean),
        physical_appearance: persona?.physical_appearance ?? "",
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
    if (!persona?.id || isDefaultPersonaRecord) return;
    if (!window.confirm(`Are you sure you want to delete persona "${persona.name}"?`)) {
      return;
    }
    setDeleting(true);
    try {
      await api.deletePersona(persona.id);
      if (onDeleted) {
        await onDeleted(persona.id);
      }
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
        className="modal-panel"
        style={{ width: "min(820px, 95vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <UserCheck size={18} color="var(--accent-emerald)" />
            <span style={{ fontWeight: 700, fontSize: "1.05rem" }}>
              {isReadOnly
                ? `Default Persona: ${persona?.name} (Read Only)`
                : clonedMode
                ? "Create Persona (Cloned from Default)"
                : isEditing
                ? `Edit Persona: ${persona?.name}`
                : "Create Player Persona"}
            </span>
            {isDefault && (
              <span
                style={{
                  fontSize: "0.72rem",
                  background: "rgba(16, 185, 129, 0.15)",
                  color: "var(--accent-emerald)",
                  padding: "2px 7px",
                  borderRadius: 4,
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Check size={11} /> Default
              </span>
            )}
          </div>
          <button
            type="button"
            className="btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X size={15} />
          </button>
        </div>

        {/* Modal Tabs */}
        <div className="modal-tabs modal-tabs-emerald" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "base"}
            className={`modal-tab-btn ${activeTab === "base" ? "active" : ""}`}
            onClick={() => setActiveTab("base")}
          >
            <User size={14} />
            <span>Base</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "appearance"}
            className={`modal-tab-btn ${activeTab === "appearance" ? "active" : ""}`}
            onClick={() => setActiveTab("appearance")}
          >
            <Eye size={14} />
            <span>Appearance</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "lore"}
            className={`modal-tab-btn ${activeTab === "lore" ? "active" : ""}`}
            onClick={() => setActiveTab("lore")}
          >
            <Lock size={14} />
            <span>Lore / Secrets</span>
            {loreEntries.length > 0 && (
              <span className="modal-tab-badge">{loreEntries.length}</span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "inventory"}
            className={`modal-tab-btn ${activeTab === "inventory" ? "active" : ""}`}
            onClick={() => setActiveTab("inventory")}
          >
            <Package size={14} />
            <span>Inventory</span>
            {equipped.length + inventory.length > 0 && (
              <span className="modal-tab-badge">{equipped.length + inventory.length}</span>
            )}
          </button>
        </div>

        {/* Modal Body / Form */}
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", overflow: "hidden", flex: 1 }}
        >
          <div className="modal-body">
            {error && (
              <div
                style={{
                  padding: "8px 12px",
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

            {/* Read-only notification banner */}
            {isReadOnly ? (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  backgroundColor: "rgba(59, 130, 246, 0.08)",
                  border: "1px solid rgba(59, 130, 246, 0.25)",
                  fontSize: "0.82rem",
                  lineHeight: 1.5,
                }}
              >
                <strong>System Default Avatar:</strong> This is the baseline persona named <em>"User"</em>.
                To customize your protagonist identity, click <strong>Clone as New Persona</strong> below.
              </div>
            ) : (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  backgroundColor: "rgba(16, 185, 129, 0.08)",
                  border: "1px solid rgba(16, 185, 129, 0.25)",
                  fontSize: "0.82rem",
                  lineHeight: 1.5,
                }}
              >
                <strong>Player Protagonist Profile:</strong> Demographics, appearance, and equipped gear establish how characters see you. Secrets remain concealed until revealed in conversation!
              </div>
            )}

            {/* TAB 1: BASE */}
            <div
              style={{
                display: activeTab === "base" ? "flex" : "none",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {/* Persona Name */}
              <div className="field-group">
                <label>
                  Persona Name <span style={{ color: "var(--accent-rose)" }}>*</span>
                </label>
                <input
                  type="text"
                  className="field-input"
                  placeholder="e.g. Deckard Shaw, Valerie Wells, Jax..."
                  value={name}
                  disabled={isReadOnly}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus={!isReadOnly}
                />
              </div>

              {/* Demographics Group: Species, Age, Sex, Pronouns */}
              <div
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 8,
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--accent-emerald)" }}>
                  Demographics &amp; Identity
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {/* Species / Heritage */}
                  <div className="field-group">
                    <label>Species / Heritage</label>
                    <input
                      type="text"
                      className="field-input"
                      placeholder="e.g. Human, Cyborg, Replicant..."
                      value={species}
                      disabled={isReadOnly}
                      onChange={(e) => setSpecies(e.target.value)}
                    />
                    {!isReadOnly && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                        {speciesShortcuts.map((sc) => (
                          <button
                            key={sc}
                            type="button"
                            className="btn btn-sm"
                            style={{ fontSize: "0.68rem", padding: "1px 6px" }}
                            onClick={() => setSpecies(sc)}
                          >
                            {sc}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Age (with Secret toggle) */}
                  <div className="field-group">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <label style={{ margin: 0 }}>Age</label>
                      {!isReadOnly && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{
                            fontSize: "0.68rem",
                            padding: "1px 6px",
                            color: ageIsSecret ? "var(--accent-amber)" : "var(--accent-emerald)",
                          }}
                          onClick={() => setAgeIsSecret(!ageIsSecret)}
                          title={ageIsSecret ? "Age is concealed until you reveal it in-game" : "Age is publicly apparent"}
                        >
                          {ageIsSecret ? <EyeOff size={11} /> : <Eye size={11} />}
                          {ageIsSecret ? "Secret" : "Public"}
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      className="field-input"
                      placeholder="e.g. 28, Unknown, Early 30s..."
                      value={age}
                      disabled={isReadOnly}
                      onChange={(e) => setAge(e.target.value)}
                    />
                    {!isReadOnly && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                        {ageShortcuts.map((sc) => (
                          <button
                            key={sc}
                            type="button"
                            className="btn btn-sm"
                            style={{ fontSize: "0.68rem", padding: "1px 6px" }}
                            onClick={() => setAge(sc)}
                          >
                            {sc}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {/* Sex */}
                  <div className="field-group">
                    <label>Sex</label>
                    <input
                      type="text"
                      className="field-input"
                      placeholder="e.g. Male, Female, Other..."
                      value={sex}
                      disabled={isReadOnly}
                      onChange={(e) => setSex(e.target.value)}
                    />
                    {!isReadOnly && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                        {sexShortcuts.map((sc) => (
                          <button
                            key={sc}
                            type="button"
                            className="btn btn-sm"
                            style={{ fontSize: "0.68rem", padding: "1px 6px" }}
                            onClick={() => setSex(sc)}
                          >
                            {sc}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Pronouns */}
                  <div className="field-group">
                    <label>Pronouns</label>
                    <input
                      type="text"
                      className="field-input"
                      placeholder="e.g. he/him, she/her, they/them..."
                      value={pronouns}
                      disabled={isReadOnly}
                      onChange={(e) => setPronouns(e.target.value)}
                    />
                    {!isReadOnly && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                        {pronounShortcuts.map((sc) => (
                          <button
                            key={sc}
                            type="button"
                            className="btn btn-sm"
                            style={{ fontSize: "0.68rem", padding: "1px 6px" }}
                            onClick={() => setPronouns(sc)}
                          >
                            {sc}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Persona Bio / High Concept */}
              <div className="field-group">
                <label>Persona Bio / High Concept (Role, Background &amp; Reputation)</label>
                <textarea
                  className="field-textarea"
                  rows={3}
                  placeholder="High-level narrative concept, background origin, occupation, or public reputation..."
                  value={personaBio}
                  disabled={isReadOnly}
                  onChange={(e) => setPersonaBio(e.target.value)}
                />
              </div>

              {/* Persona Tags */}
              <div className="field-group">
                <label>Persona Tags</label>
                <TagChipsInput
                  value={tags}
                  onChange={setTags}
                  disabled={isReadOnly}
                  placeholder="Add persona tag (e.g. netrunner, solo, corporate, investigator)..."
                />
              </div>
            </div>

            {/* TAB 2: APPEARANCE */}
            <div
              style={{
                display: activeTab === "appearance" ? "flex" : "none",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {/* Build & Height */}
              <div className="field-group">
                <label>Build &amp; Height</label>
                <input
                  type="text"
                  className="field-input"
                  placeholder="e.g. 182 cm, lean wiry cybernetic frame..."
                  value={buildAndHeight}
                  disabled={isReadOnly}
                  onChange={(e) => setBuildAndHeight(e.target.value)}
                />
              </div>

              {/* Distinctive Features */}
              <div className="field-group">
                <label>Distinctive Features (Anatomy, Hair, Eyes, Scars, Cyberware — Optional)</label>
                <TagChipsInput
                  value={distinctiveFeatures}
                  onChange={setDistinctiveFeatures}
                  disabled={isReadOnly}
                  placeholder="Add physical trait (e.g. neon blue iris, scarred eyebrow, cybernetic left arm)..."
                />
              </div>
            </div>

            {/* TAB 3: LORE & SECRETS */}
            <div
              style={{
                display: activeTab === "lore" ? "flex" : "none",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <div
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 8,
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="sidebar-label" style={{ fontWeight: 600, color: "var(--accent-emerald)" }}>
                    Lore Entries &amp; Backstory Secrets ({loreEntries.length})
                  </span>
                  {!isReadOnly && (
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                      onClick={handleAddLore}
                    >
                      <Plus size={12} /> Add Secret / Lore
                    </button>
                  )}
                </div>

                {loreEntries.length === 0 ? (
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                    No secrets or hidden backstory entries defined. Add entries that characters can uncover during the story!
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {loreEntries.map((l, idx) => (
                      <div
                        key={l.id || idx}
                        style={{
                          background: "var(--bg-panel)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: 8,
                          padding: 10,
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            type="text"
                            className="field-input"
                            placeholder="Title of secret (e.g. Ex-Militech Operative)..."
                            value={l.title}
                            disabled={isReadOnly}
                            onChange={(e) => {
                              const next = [...loreEntries];
                              next[idx] = { ...next[idx], title: e.target.value };
                              setLoreEntries(next);
                            }}
                            style={{ flex: 1, fontWeight: 600 }}
                          />
                          {!isReadOnly && (
                            <button
                              type="button"
                              onClick={() => {
                                const next = [...loreEntries];
                                next[idx] = { ...next[idx], is_secret: !next[idx].is_secret };
                                setLoreEntries(next);
                              }}
                              className="btn btn-sm"
                              style={{
                                color: l.is_secret ? "var(--accent-amber)" : "var(--accent-emerald)",
                                fontSize: "0.72rem",
                                padding: "3px 8px",
                              }}
                              title={l.is_secret ? "Secret: Only NPCs who have unlocked this entry recall it" : "Public: Known by everyone in the scene"}
                            >
                              {l.is_secret ? <EyeOff size={12} /> : <Eye size={12} />}
                              {l.is_secret ? "Secret" : "Public"}
                            </button>
                          )}
                          {!isReadOnly && (
                            <button
                              type="button"
                              className="btn"
                              style={{ color: "var(--accent-rose)", padding: "3px 8px" }}
                              onClick={() => setLoreEntries(loreEntries.filter((_, i) => i !== idx))}
                              title="Delete secret entry"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>

                        <textarea
                          className="field-textarea"
                          rows={2}
                          placeholder="Content of the secret or lore entry..."
                          value={l.content}
                          disabled={isReadOnly}
                          onChange={(e) => {
                            const next = [...loreEntries];
                            next[idx] = { ...next[idx], content: e.target.value };
                            setLoreEntries(next);
                          }}
                        />

                        {l.is_secret && (
                          <div style={{ marginTop: 4 }}>
                            <label style={{ fontSize: "0.74rem", color: "var(--text-muted)", display: "block", marginBottom: 3 }}>
                              Trigger Keywords to Reveal in Conversation:
                            </label>
                            <TagChipsInput
                              value={l.trigger_keywords || []}
                              disabled={isReadOnly}
                              onChange={(tags) => {
                                const next = [...loreEntries];
                                next[idx] = { ...next[idx], trigger_keywords: tags };
                                setLoreEntries(next);
                              }}
                              placeholder="Add trigger keyword (e.g. arasaka tower, militech, undercover)..."
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* TAB 4: INVENTORY */}
            <div
              style={{
                display: activeTab === "inventory" ? "flex" : "none",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {/* Equipped Attire & Gear */}
              <div
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 8,
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="sidebar-label" style={{ fontWeight: 600, color: "var(--accent-emerald)" }}>
                    Equipped Attire &amp; Gear ({equipped.length})
                  </span>
                  {!isReadOnly && (
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                      onClick={handleAddEquipped}
                    >
                      <Plus size={12} /> Add Equipped
                    </button>
                  )}
                </div>

                {equipped.length === 0 ? (
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                    No worn garments or visible gear specified.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {equipped.map((item, idx) => {
                      const rowKey = `eq:${item.id || idx}`;
                      const isExpanded = expandedItemKey === rowKey;
                      const hasNote = Boolean(item.note && item.note.trim());
                      return (
                        <div
                          key={rowKey}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                            padding: 8,
                            borderRadius: 6,
                            border: isExpanded
                              ? "1px solid var(--accent-emerald)"
                              : "1px solid var(--border-subtle)",
                            background: "var(--bg-panel)",
                          }}
                        >
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <input
                              type="text"
                              className="field-input"
                              placeholder="e.g. Reinforced Trenchcoat..."
                              value={item.name}
                              disabled={isReadOnly}
                              onChange={(e) => {
                                const next = [...equipped];
                                next[idx] = { ...next[idx], name: e.target.value };
                                setEquipped(next);
                              }}
                              style={{ flex: 1 }}
                            />
                            {!isReadOnly && (
                              <button
                                type="button"
                                className="btn"
                                style={{ padding: "4px 8px", fontSize: "0.7rem", display: "inline-flex", alignItems: "center", gap: 4 }}
                                onClick={() => setExpandedItemKey(isExpanded ? null : rowKey)}
                              >
                                {item.is_secret ? <EyeOff size={11} color="var(--accent-amber)" /> : <Eye size={11} color="var(--accent-emerald)" />}
                                {hasNote && <FileText size={11} color="var(--accent-emerald)" />}
                                <span>Details</span>
                                {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                              </button>
                            )}
                            {!isReadOnly && (
                              <button
                                type="button"
                                className="btn"
                                style={{ color: "var(--accent-rose)", padding: "4px 8px" }}
                                onClick={() => setEquipped(equipped.filter((_, i) => i !== idx))}
                                title="Remove equipped gear"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>

                          {isExpanded && (
                            <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}>
                              <textarea
                                className="field-textarea"
                                rows={2}
                                maxLength={300}
                                placeholder="Sensory details, style notes, or function..."
                                value={item.note || ""}
                                disabled={isReadOnly}
                                onChange={(e) => {
                                  const next = [...equipped];
                                  next[idx] = { ...next[idx], note: e.target.value };
                                  setEquipped(next);
                                }}
                              />
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  style={{
                                    fontSize: "0.72rem",
                                    color: item.is_secret ? "var(--accent-amber)" : "var(--accent-emerald)",
                                  }}
                                  onClick={() => {
                                    const next = [...equipped];
                                    next[idx] = { ...next[idx], is_secret: !next[idx].is_secret };
                                    setEquipped(next);
                                  }}
                                >
                                  {item.is_secret ? <EyeOff size={12} /> : <Eye size={12} />}
                                  {item.is_secret ? "Secret (Concealed Gear)" : "Public (Visible Attire)"}
                                </button>
                              </div>
                              {item.is_secret && (
                                <div>
                                  <label style={{ fontSize: "0.72rem", color: "var(--text-muted)", display: "block", marginBottom: 3 }}>
                                    Trigger keywords to reveal gear in scene:
                                  </label>
                                  <TagChipsInput
                                    value={item.trigger_keywords || []}
                                    disabled={isReadOnly}
                                    onChange={(tags) => {
                                      const next = [...equipped];
                                      next[idx] = { ...next[idx], trigger_keywords: tags };
                                      setEquipped(next);
                                    }}
                                    placeholder="Add trigger keyword (e.g. trenchcoat, armored coat)..."
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Carried Inventory & Objects */}
              <div
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 8,
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="sidebar-label" style={{ fontWeight: 600, color: "var(--accent-emerald)" }}>
                    Carried Inventory &amp; Objects ({inventory.length})
                  </span>
                  {!isReadOnly && (
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                      onClick={handleAddInventory}
                    >
                      <Plus size={12} /> Add Carried Item
                    </button>
                  )}
                </div>

                {inventory.length === 0 ? (
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                    No carried inventory, concealed tools, or pocket items specified.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {inventory.map((item, idx) => {
                      const rowKey = `inv:${item.id || idx}`;
                      const isExpanded = expandedItemKey === rowKey;
                      const hasNote = Boolean(item.note && item.note.trim());
                      return (
                        <div
                          key={rowKey}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                            padding: 8,
                            borderRadius: 6,
                            border: isExpanded
                              ? "1px solid var(--accent-emerald)"
                              : "1px solid var(--border-subtle)",
                            background: "var(--bg-panel)",
                          }}
                        >
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <input
                              type="text"
                              className="field-input"
                              placeholder="e.g. Militech Cyberdeck..."
                              value={item.name}
                              disabled={isReadOnly}
                              onChange={(e) => {
                                const next = [...inventory];
                                next[idx] = { ...next[idx], name: e.target.value };
                                setInventory(next);
                              }}
                              style={{ flex: 1 }}
                            />
                            {!isReadOnly && (
                              <button
                                type="button"
                                className="btn"
                                style={{ padding: "4px 8px", fontSize: "0.7rem", display: "inline-flex", alignItems: "center", gap: 4 }}
                                onClick={() => setExpandedItemKey(isExpanded ? null : rowKey)}
                              >
                                {item.is_secret ? <EyeOff size={11} color="var(--accent-amber)" /> : <Eye size={11} color="var(--accent-emerald)" />}
                                {hasNote && <FileText size={11} color="var(--accent-emerald)" />}
                                <span>Details</span>
                                {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                              </button>
                            )}
                            {!isReadOnly && (
                              <button
                                type="button"
                                className="btn"
                                style={{ color: "var(--accent-rose)", padding: "4px 8px" }}
                                onClick={() => setInventory(inventory.filter((_, i) => i !== idx))}
                                title="Remove carried item"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>

                          {isExpanded && (
                            <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 8, padding: "4px 0" }}>
                              <textarea
                                className="field-textarea"
                                rows={2}
                                maxLength={300}
                                placeholder="Sensory details, illicit properties, or function..."
                                value={item.note || ""}
                                disabled={isReadOnly}
                                onChange={(e) => {
                                  const next = [...inventory];
                                  next[idx] = { ...next[idx], note: e.target.value };
                                  setInventory(next);
                                }}
                              />
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <button
                                  type="button"
                                  className="btn btn-sm"
                                  style={{
                                    fontSize: "0.72rem",
                                    color: item.is_secret ? "var(--accent-amber)" : "var(--accent-emerald)",
                                  }}
                                  onClick={() => {
                                    const next = [...inventory];
                                    next[idx] = { ...next[idx], is_secret: !next[idx].is_secret };
                                    setInventory(next);
                                  }}
                                >
                                  {item.is_secret ? <EyeOff size={12} /> : <Eye size={12} />}
                                  {item.is_secret ? "Secret (Concealed Item)" : "Public (Openly Held)"}
                                </button>
                              </div>
                              {item.is_secret && (
                                <div>
                                  <label style={{ fontSize: "0.72rem", color: "var(--text-muted)", display: "block", marginBottom: 3 }}>
                                    Trigger keywords to reveal carried item in scene:
                                  </label>
                                  <TagChipsInput
                                    value={item.trigger_keywords || []}
                                    disabled={isReadOnly}
                                    onChange={(tags) => {
                                      const next = [...inventory];
                                      next[idx] = { ...next[idx], trigger_keywords: tags };
                                      setInventory(next);
                                    }}
                                    placeholder="Add trigger keyword (e.g. cyberdeck, trauma kit)..."
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Modal Footer */}
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
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {isEditing && !isDefaultPersonaRecord && (
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

              {/* Set as Default Button / Default Badge */}
              {isEditing && !isDefaultPersonaRecord && onSetDefault && (
                isDefault ? (
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--accent-emerald)",
                      border: "1px solid var(--accent-emerald)",
                      padding: "3px 8px",
                      borderRadius: 6,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontWeight: 600,
                    }}
                    title="This persona is currently selected by default for new campaigns"
                  >
                    <Check size={12} /> Default Persona
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => persona && onSetDefault(persona)}
                    title="Pick this persona by default when creating new campaigns"
                    style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                  >
                    <UserCheck size={13} color="var(--accent-emerald)" /> Set as Default
                  </button>
                )
              )}
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                className="btn"
                onClick={onClose}
                disabled={saving || deleting}
              >
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
