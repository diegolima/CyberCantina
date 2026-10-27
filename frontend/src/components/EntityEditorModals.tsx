import React, { useState } from "react";
import {
  BookOpen,
  Brain,
  Check,
  Compass,
  Database,
  Edit3,
  Globe,
  HeartPulse,
  Package,
  Plus,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";
import { api } from "../api";
import {
  CharacterRecord,
  CompassDirection,
  LocationEdge,
  LocationNode,
  LoreNode,
  MemoryShard,
  VoiceAnchor,
  WorldRecord,
} from "../types";
import { OPPOSITE_COMPASS, SpatialTopologyView } from "./SpatialTopologyView";

interface ClickToEditFieldProps {
  label?: string;
  value: string;
  onChange: (next: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
}

const ClickToEditField: React.FC<ClickToEditFieldProps> = ({
  label,
  value,
  onChange,
  multiline = false,
  rows = 3,
  placeholder = "Click to edit...",
}) => {
  const [editing, setEditing] = useState(false);

  return (
    <div className="field-group">
      {label && <label>{label}</label>}
      {editing ? (
        multiline ? (
          <textarea
            className="field-textarea"
            rows={rows}
            autoFocus
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
          />
        ) : (
          <input
            className="field-input"
            autoFocus
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setEditing(false);
            }}
          />
        )
      ) : (
        <div
          className="editable-field-box"
          onClick={() => setEditing(true)}
          title="Click to edit field"
        >
          <span className="editable-field-hint">
            <Edit3 size={11} /> Click to edit
          </span>
          {value && value.trim().length > 0 ? (
            value
          ) : (
            <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
              {placeholder}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Character Inspector & Inline Editor Modal
// ============================================================================

interface CharacterInspectorModalProps {
  character: CharacterRecord;
  worlds: WorldRecord[];
  onClose: () => void;
  onSaved: (updated: CharacterRecord) => void;
}

type CharacterTab = "base" | "personality" | "memories" | "inventory";

export const CharacterInspectorModal: React.FC<
  CharacterInspectorModalProps
> = ({ character, worlds, onClose, onSaved }) => {
  const [activeTab, setActiveTab] = useState<CharacterTab>("base");
  const [name, setName] = useState(character.name);
  const [tagline, setTagline] = useState(character.tagline);
  const [worldId, setWorldId] = useState<string>(character.world_id ?? "");
  const [physicalAppearance, setPhysicalAppearance] = useState(
    character.physical_appearance ?? ""
  );
  const [corePersona, setCorePersona] = useState(character.core_persona);
  const [initialMessage, setInitialMessage] = useState(
    character.initial_message ?? ""
  );
  const [equipped, setEquipped] = useState<string[]>([
    ...(character.equipped ?? []),
  ]);
  const [inventory, setInventory] = useState<string[]>([
    ...(character.inventory ?? []),
  ]);
  const [baselinePsyche, setBaselinePsyche] = useState({
    ...character.baseline_psyche,
  });
  const [voiceAnchors, setVoiceAnchors] = useState<VoiceAnchor[]>(
    character.voice_anchors.map((v) => ({ ...v }))
  );
  const [memoryShards, setMemoryShards] = useState<MemoryShard[]>(
    character.memory_shards.map((m) => ({ ...m, keywords: [...m.keywords] }))
  );

  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const markDirty = () => {
    if (!isDirty) setIsDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateCharacter(character.id, {
        name: name.trim() || character.name,
        tagline: tagline.trim(),
        physical_appearance: physicalAppearance.trim(),
        core_persona: corePersona.trim(),
        initial_message: initialMessage.trim(),
        equipped: equipped.map((i) => i.trim()).filter(Boolean),
        inventory: inventory.map((i) => i.trim()).filter(Boolean),
        voice_anchors: voiceAnchors,
        baseline_psyche: baselinePsyche,
        memory_shards: memoryShards,
        world_id: worldId || null,
      });
      onSaved(updated);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        style={{ width: "min(820px, 95vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Users size={18} color="var(--accent-amber)" />
            Character Sheet
          </span>
          <button type="button" className="btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-tabs" role="tablist">
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
            aria-selected={activeTab === "personality"}
            className={`modal-tab-btn ${activeTab === "personality" ? "active" : ""}`}
            onClick={() => setActiveTab("personality")}
          >
            <Brain size={14} />
            <span>Personality</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "memories"}
            className={`modal-tab-btn ${activeTab === "memories" ? "active" : ""}`}
            onClick={() => setActiveTab("memories")}
          >
            <Database size={14} />
            <span>Memories</span>
            <span className="modal-tab-badge">{memoryShards.length}</span>
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
            <span className="modal-tab-badge">{equipped.length + inventory.length}</span>
          </button>
        </div>

        <div className="modal-body">
          {/* Base Tab */}
          <div
            style={{
              display: activeTab === "base" ? "flex" : "none",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div
              style={{
                fontSize: "0.76rem",
                color: "var(--text-secondary)",
                background: "var(--bg-card)",
                padding: "8px 12px",
                borderRadius: 6,
                border: "1px solid var(--border-subtle)",
              }}
            >
              Click on any field below to edit it. Active campaigns using this
              character remain pinned to their original snapshot automatically.
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <ClickToEditField
                label="Character Name"
                value={name}
                onChange={(val) => {
                  setName(val);
                  markDirty();
                }}
              />
              <div className="field-group">
                <label>Home World Association</label>
                <select
                  className="field-select"
                  value={worldId}
                  onChange={(e) => {
                    setWorldId(e.target.value);
                    markDirty();
                  }}
                >
                  <option value="">Standalone (No specific world)</option>
                  {worlds.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.global_rules.genre})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <ClickToEditField
              label="Evocative Tagline"
              value={tagline}
              onChange={(val) => {
                setTagline(val);
                markDirty();
              }}
            />

            <ClickToEditField
              label="Physical Appearance (Zone 1 Static Anatomy & Features — Excludes Clothing/Items)"
              value={physicalAppearance}
              multiline
              rows={3}
              placeholder="Describe build, facial features, hair, eyes, scars, or cyberware..."
              onChange={(val) => {
                setPhysicalAppearance(val);
                markDirty();
              }}
            />

            <ClickToEditField
              label="Initial Message (Turn 0 Opening Scene Prose)"
              value={initialMessage}
              multiline
              rows={4}
              placeholder="Opening scene narrative and dialogue when starting a campaign..."
              onChange={(val) => {
                setInitialMessage(val);
                markDirty();
              }}
            />
          </div>

          {/* Personality Tab */}
          <div
            style={{
              display: activeTab === "personality" ? "flex" : "none",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <ClickToEditField
              label="Core Persona (Zone 1 Static Demeanor, Psychology & Speech Habits)"
              value={corePersona}
              multiline
              rows={5}
              onChange={(val) => {
                setCorePersona(val);
                markDirty();
              }}
            />

            {/* Baseline Psyche & Motivational Drives */}
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
              <div
                className="sidebar-label"
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <HeartPulse size={13} color="#ec4899" />
                Baseline Psyche & Initial Drives
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr 1fr",
                  gap: 10,
                }}
              >
                <ClickToEditField
                  label="Baseline Mood Label"
                  value={baselinePsyche.mood_label}
                  onChange={(val) => {
                    setBaselinePsyche({ ...baselinePsyche, mood_label: val });
                    markDirty();
                  }}
                />
                <div className="field-group">
                  <label>Valence (-1.0 to +1.0)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="-1"
                    max="1"
                    className="field-input"
                    value={baselinePsyche.valence}
                    onChange={(e) => {
                      setBaselinePsyche({
                        ...baselinePsyche,
                        valence: Math.max(
                          -1,
                          Math.min(1, Number(e.target.value) || 0)
                        ),
                      });
                      markDirty();
                    }}
                  />
                </div>
                <div className="field-group">
                  <label>Arousal (0.0 to 1.0)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="1"
                    className="field-input"
                    value={baselinePsyche.arousal}
                    onChange={(e) => {
                      setBaselinePsyche({
                        ...baselinePsyche,
                        arousal: Math.max(
                          0,
                          Math.min(1, Number(e.target.value) || 0)
                        ),
                      });
                      markDirty();
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                <ClickToEditField
                  label="Core Long-Term Drive"
                  value={baselinePsyche.core_drive}
                  multiline
                  rows={2}
                  onChange={(val) => {
                    setBaselinePsyche({ ...baselinePsyche, core_drive: val });
                    markDirty();
                  }}
                />
                <ClickToEditField
                  label="Core Fear"
                  value={baselinePsyche.core_fear}
                  multiline
                  rows={2}
                  onChange={(val) => {
                    setBaselinePsyche({ ...baselinePsyche, core_fear: val });
                    markDirty();
                  }}
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                <ClickToEditField
                  label="Default Scene Want"
                  value={baselinePsyche.default_want}
                  multiline
                  rows={2}
                  onChange={(val) => {
                    setBaselinePsyche({ ...baselinePsyche, default_want: val });
                    markDirty();
                  }}
                />
                <ClickToEditField
                  label="Default Action Plan"
                  value={baselinePsyche.default_plan}
                  multiline
                  rows={2}
                  onChange={(val) => {
                    setBaselinePsyche({ ...baselinePsyche, default_plan: val });
                    markDirty();
                  }}
                />
              </div>
            </div>

            {/* Voice Anchors */}
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
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span className="sidebar-label">
                  Voice & Dialogue Anchors ({voiceAnchors.length})
                </span>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                  onClick={() => {
                    setVoiceAnchors([
                      ...voiceAnchors,
                      { context: "New Context", snippet: "Sample dialogue..." },
                    ]);
                    markDirty();
                  }}
                >
                  <Plus size={12} /> Add Anchor
                </button>
              </div>

              {voiceAnchors.length === 0 ? (
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  No voice anchors specified. Add anchors to guide speech cadence and mannerisms.
                </div>
              ) : (
                voiceAnchors.map((va, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: "var(--bg-panel)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 6,
                      padding: 10,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 8,
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <ClickToEditField
                          label="Context"
                          value={va.context}
                          onChange={(val) => {
                            const next = [...voiceAnchors];
                            next[idx] = { ...next[idx], context: val };
                            setVoiceAnchors(next);
                            markDirty();
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        className="item-remove-btn"
                        style={{ marginTop: 22 }}
                        onClick={() => {
                          setVoiceAnchors(
                            voiceAnchors.filter((_, i) => i !== idx)
                          );
                          markDirty();
                        }}
                        title="Remove voice anchor"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <ClickToEditField
                      label="Sample Dialogue & Action Snippet"
                      value={va.snippet}
                      multiline
                      rows={2}
                      onChange={(val) => {
                        const next = [...voiceAnchors];
                        next[idx] = { ...next[idx], snippet: val };
                        setVoiceAnchors(next);
                        markDirty();
                      }}
                    />
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Memories Tab */}
          <div
            style={{
              display: activeTab === "memories" ? "flex" : "none",
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
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span className="sidebar-label">
                  Backstory Memory Shards — Hybrid GraphRAG ({memoryShards.length})
                </span>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                  onClick={() => {
                    setMemoryShards([
                      ...memoryShards,
                      {
                        title: "New Backstory Memory",
                        content: "Describe a key memory or secret...",
                        keywords: [],
                        emotional_weight: 0.7,
                      },
                    ]);
                    markDirty();
                  }}
                >
                  <Plus size={12} /> Add Memory Shard
                </button>
              </div>

              {memoryShards.length === 0 ? (
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  No backstory memory shards indexed. Add shards to anchor GraphRAG retrieval during narrative turns.
                </div>
              ) : (
                memoryShards.map((shard, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: "var(--bg-panel)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 6,
                      padding: 10,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr auto",
                        gap: 8,
                        alignItems: "start",
                      }}
                    >
                      <ClickToEditField
                        label="Shard Title"
                        value={shard.title}
                        onChange={(val) => {
                          const next = [...memoryShards];
                          next[idx] = { ...next[idx], title: val };
                          setMemoryShards(next);
                          markDirty();
                        }}
                      />
                      <ClickToEditField
                        label="Trigger Keywords (comma-separated)"
                        value={shard.keywords.join(", ")}
                        onChange={(val) => {
                          const next = [...memoryShards];
                          next[idx] = {
                            ...next[idx],
                            keywords: val
                              .split(",")
                              .map((k) => k.trim())
                              .filter(Boolean),
                          };
                          setMemoryShards(next);
                          markDirty();
                        }}
                      />
                      <button
                        type="button"
                        className="item-remove-btn"
                        style={{ marginTop: 22 }}
                        onClick={() => {
                          setMemoryShards(
                            memoryShards.filter((_, i) => i !== idx)
                          );
                          markDirty();
                        }}
                        title="Remove memory shard"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    <ClickToEditField
                      label="Memory Content"
                      value={shard.content}
                      multiline
                      rows={2}
                      onChange={(val) => {
                        const next = [...memoryShards];
                        next[idx] = { ...next[idx], content: val };
                        setMemoryShards(next);
                        markDirty();
                      }}
                    />
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Inventory Tab */}
          <div
            style={{
              display: activeTab === "inventory" ? "flex" : "none",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {/* Equipped Attire */}
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
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span className="sidebar-label">
                  Equipped Attire &amp; Gear ({equipped.length})
                </span>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                  onClick={() => {
                    setEquipped([...equipped, "New equipped attire"]);
                    markDirty();
                  }}
                >
                  <Plus size={12} /> Add Equipped
                </button>
              </div>

              {equipped.length === 0 ? (
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  No starting attire or worn gear specified.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {equipped.map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        gap: 8,
                        alignItems: "center",
                      }}
                    >
                      <ClickToEditField
                        value={item}
                        placeholder="e.g. Weathered leather duster"
                        onChange={(val) => {
                          const next = [...equipped];
                          next[idx] = val;
                          setEquipped(next);
                          markDirty();
                        }}
                      />
                      <button
                        type="button"
                        className="item-remove-btn"
                        onClick={() => {
                          setEquipped(equipped.filter((_, i) => i !== idx));
                          markDirty();
                        }}
                        title="Remove equipped item"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Carried Inventory */}
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
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span className="sidebar-label">
                  Carried Inventory &amp; Objects ({inventory.length})
                </span>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                  onClick={() => {
                    setInventory([...inventory, "New carried item"]);
                    markDirty();
                  }}
                >
                  <Plus size={12} /> Add Item
                </button>
              </div>

              {inventory.length === 0 ? (
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  No starting carried items specified.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {inventory.map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        gap: 8,
                        alignItems: "center",
                      }}
                    >
                      <ClickToEditField
                        value={item}
                        placeholder="e.g. Diagnostic scanner or Keycard"
                        onChange={(val) => {
                          const next = [...inventory];
                          next[idx] = val;
                          setInventory(next);
                          markDirty();
                        }}
                      />
                      <button
                        type="button"
                        className="item-remove-btn"
                        onClick={() => {
                          setInventory(inventory.filter((_, i) => i !== idx));
                          markDirty();
                        }}
                        title="Remove item"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {error && <div style={{ color: "#fda4af" }}>{error}</div>}
        </div>

        <div className="modal-footer">
          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
            {isDirty
              ? "Unsaved edits ready. Saving preserves existing campaigns via silent versioning."
              : "Click any field above to edit."}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className="btn" onClick={onClose}>
              {isDirty ? "Cancel" : "Close"}
            </button>
            {isDirty && (
              <button
                type="button"
                className="btn btn-amber"
                disabled={saving}
                onClick={handleSave}
              >
                <Check size={14} />
                {saving ? "Saving..." : "Save Changes"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// World Inspector & Inline Editor Modal
// ============================================================================

interface WorldInspectorModalProps {
  world: WorldRecord;
  onClose: () => void;
  onSaved: (updated: WorldRecord) => void;
}

type WorldTab = "base" | "map" | "lore";

export const WorldInspectorModal: React.FC<WorldInspectorModalProps> = ({
  world,
  onClose,
  onSaved,
}) => {
  const [activeTab, setActiveTab] = useState<WorldTab>("base");
  const [name, setName] = useState(world.name);
  const [globalRules, setGlobalRules] = useState({ ...world.global_rules });
  const [locations, setLocations] = useState<LocationNode[]>(
    world.locations
      .filter((loc) => !loc.created_at_turn_id)
      .map((loc) => ({
        ...loc,
        environmental_tags: [...loc.environmental_tags],
      }))
  );
  const [edges, setEdges] = useState<LocationEdge[]>(
    world.edges
      .filter((edge) => !edge.created_at_turn_id)
      .map((edge) => ({ ...edge }))
  );
  const [loreNodes, setLoreNodes] = useState<LoreNode[]>(
    world.lore_nodes.map((lore) => ({
      ...lore,
      entity_tags: [...lore.entity_tags],
    }))
  );

  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const markDirty = () => {
    if (!isDirty) setIsDirty(true);
  };

  const handleSetStartingLocation = (targetLocId: string) => {
    setLocations((prev) =>
      prev.map((loc) => ({
        ...loc,
        is_starting_location: loc.id === targetLocId,
      }))
    );
    markDirty();
  };

  const handleUpdateLocation = (updated: LocationNode) => {
    setLocations((prev) =>
      prev.map((loc) => (loc.id === updated.id ? updated : loc))
    );
    markDirty();
  };

  const handleDeleteLocation = (targetLocId: string) => {
    if (locations.length <= 1) return;
    const remaining = locations.filter((l) => l.id !== targetLocId);
    const wasStarting = locations.find((l) => l.id === targetLocId)?.is_starting_location;
    if (wasStarting && remaining.length > 0) {
      remaining[0] = { ...remaining[0], is_starting_location: true };
    }
    setLocations(remaining);
    setEdges((prev) =>
      prev.filter(
        (e) =>
          e.from_location_id !== targetLocId && e.to_location_id !== targetLocId
      )
    );
    markDirty();
  };

  const handleDeleteEdge = (edgeId: string) => {
    setEdges((prev) => prev.filter((e) => e.id !== edgeId));
    markDirty();
  };

  const handleAddEdge = (payload: {
    from_location_id: string;
    to_location_id: string;
    direction_label: string;
    compass_direction: CompassDirection;
    travel_minutes: number;
    bidirectional?: boolean;
  }) => {
    const newEdgeId = `edge_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newEdge: LocationEdge = {
      id: newEdgeId,
      world_id: world.id,
      from_location_id: payload.from_location_id,
      to_location_id: payload.to_location_id,
      direction_label: payload.direction_label,
      compass_direction: payload.compass_direction,
      travel_minutes: payload.travel_minutes,
      is_locked_or_hidden: false,
    };
    const nextEdges = [...edges, newEdge];
    if (payload.bidirectional) {
      const returnEdgeId = `edge_${Date.now()}_rev_${Math.random().toString(36).slice(2, 6)}`;
      nextEdges.push({
        id: returnEdgeId,
        world_id: world.id,
        from_location_id: payload.to_location_id,
        to_location_id: payload.from_location_id,
        direction_label: `Return passage`,
        compass_direction: OPPOSITE_COMPASS[payload.compass_direction],
        travel_minutes: payload.travel_minutes,
        is_locked_or_hidden: false,
      });
    }
    setEdges(nextEdges);
    markDirty();
  };

  const handleCreateLinkedLocation = async (payload: {
    from_location_id: string;
    name: string;
    compass_direction: CompassDirection;
    travel_minutes: number;
    description: string;
    environmental_tags: string[];
    is_hub?: boolean;
    summary?: string;
  }): Promise<string> => {
    const newLocId = `new_loc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const fromLoc = locations.find((l) => l.id === payload.from_location_id);
    const newLoc: LocationNode = {
      id: newLocId,
      world_id: world.id,
      name: payload.name,
      summary: payload.summary || payload.name,
      description: payload.description,
      environmental_tags: payload.environmental_tags,
      is_starting_location: false,
      is_hub: Boolean(payload.is_hub),
    };
    const fwdEdgeId = `new_edge_${Date.now()}_fwd`;
    const revEdgeId = `new_edge_${Date.now()}_rev`;
    const fwdEdge: LocationEdge = {
      id: fwdEdgeId,
      world_id: world.id,
      from_location_id: payload.from_location_id,
      to_location_id: newLocId,
      direction_label: `Passage to ${payload.name}`,
      compass_direction: payload.compass_direction,
      travel_minutes: payload.travel_minutes,
      is_locked_or_hidden: false,
    };
    const revEdge: LocationEdge = {
      id: revEdgeId,
      world_id: world.id,
      from_location_id: newLocId,
      to_location_id: payload.from_location_id,
      direction_label: `Back to ${fromLoc?.name ?? "adjoining room"}`,
      compass_direction: OPPOSITE_COMPASS[payload.compass_direction],
      travel_minutes: payload.travel_minutes,
      is_locked_or_hidden: false,
    };
    setLocations((prev) => [...prev, newLoc]);
    setEdges((prev) => [...prev, fwdEdge, revEdge]);
    markDirty();
    return newLocId;
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateWorld(world.id, {
        name: name.trim() || world.name,
        global_rules: globalRules,
        locations,
        edges,
        lore_nodes: loreNodes,
      });
      onSaved(updated);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        style={{
          width: activeTab === "map" ? "min(1120px, 96vw)" : "min(860px, 95vw)",
          transition: "width 0.2s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Globe size={18} color="var(--accent-cyan)" />
            World Sheet
          </span>
          <button type="button" className="btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-tabs modal-tabs-cyan" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "base"}
            className={`modal-tab-btn ${activeTab === "base" ? "active" : ""}`}
            onClick={() => setActiveTab("base")}
          >
            <Globe size={14} />
            <span>Base</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "map"}
            className={`modal-tab-btn ${activeTab === "map" ? "active" : ""}`}
            onClick={() => setActiveTab("map")}
          >
            <Compass size={14} />
            <span>Map</span>
            <span className="modal-tab-badge">{locations.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "lore"}
            className={`modal-tab-btn ${activeTab === "lore" ? "active" : ""}`}
            onClick={() => setActiveTab("lore")}
          >
            <BookOpen size={14} />
            <span>Lore</span>
            <span className="modal-tab-badge">{loreNodes.length}</span>
          </button>
        </div>

        <div className="modal-body">
          {/* Base Tab */}
          <div
            style={{
              display: activeTab === "base" ? "flex" : "none",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div
              style={{
                fontSize: "0.76rem",
                color: "var(--text-secondary)",
                background: "var(--bg-card)",
                padding: "8px 12px",
                borderRadius: 6,
                border: "1px solid var(--border-subtle)",
              }}
            >
              Click on any field below to edit it. Active campaigns running in
              this world remain pinned to their original world snapshot
              automatically.
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 12,
              }}
            >
              <ClickToEditField
                label="World Name"
                value={name}
                onChange={(val) => {
                  setName(val);
                  markDirty();
                }}
              />
              <ClickToEditField
                label="Genre"
                value={globalRules.genre}
                onChange={(val) => {
                  setGlobalRules({ ...globalRules, genre: val });
                  markDirty();
                }}
              />
              <ClickToEditField
                label="Starting Clock (YYYY-MM-DD HH:MM)"
                value={globalRules.starting_timestamp}
                onChange={(val) => {
                  setGlobalRules({ ...globalRules, starting_timestamp: val });
                  markDirty();
                }}
              />
            </div>

            <ClickToEditField
              label="Narrative Tone & Stylistic Atmosphere"
              value={globalRules.tone}
              onChange={(val) => {
                setGlobalRules({ ...globalRules, tone: val });
                markDirty();
              }}
            />

            <ClickToEditField
              label="Setting Overview (Zone 1 Static Prefix)"
              value={globalRules.setting_overview}
              multiline
              rows={3}
              onChange={(val) => {
                setGlobalRules({ ...globalRules, setting_overview: val });
                markDirty();
              }}
            />

            <ClickToEditField
              label="Technology / Magic / World Consistency Rules"
              value={globalRules.tech_or_magic_rules}
              multiline
              rows={2}
              onChange={(val) => {
                setGlobalRules({ ...globalRules, tech_or_magic_rules: val });
                markDirty();
              }}
            />
          </div>

          {/* Map Tab */}
          <div
            style={{
              display: activeTab === "map" ? "flex" : "none",
              flexDirection: "column",
              gap: 10,
            }}
          >
            {locations.length === 0 ? (
              <div
                style={{
                  padding: 30,
                  textAlign: "center",
                  background: "var(--bg-deep)",
                  borderRadius: 8,
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div style={{ color: "var(--text-muted)", marginBottom: 12 }}>
                  No spatial locations defined. Add an initial starting hub to anchor your map.
                </div>
                <button
                  type="button"
                  className="btn btn-amber"
                  onClick={() => {
                    const newId = `new_loc_${Date.now()}`;
                    setLocations([
                      {
                        id: newId,
                        world_id: world.id,
                        name: "Main Plaza / Starting Hub",
                        summary: "Central arrival threshold and starting hub.",
                        description:
                          "The primary gathering hub and central gateway connecting adjoining sectors.",
                        environmental_tags: ["hub", "central", "open"],
                        is_starting_location: true,
                        is_hub: true,
                      },
                    ]);
                    markDirty();
                  }}
                >
                  <Plus size={14} /> Create Starting Hub
                </button>
              </div>
            ) : (
              <SpatialTopologyView
                title={`${name} — Spatial Topology (${locations.length} Locations, ${edges.length} Passages)`}
                locations={locations}
                edges={edges}
                activeLocationId={
                  locations.find((l) => l.is_starting_location)?.id ??
                  locations[0]?.id ??
                  ""
                }
                mode="editor"
                onUpdateLocation={handleUpdateLocation}
                onDeleteLocation={handleDeleteLocation}
                onSetStartingLocation={handleSetStartingLocation}
                onAddEdge={handleAddEdge}
                onDeleteEdge={handleDeleteEdge}
                onCreateLinkedLocation={handleCreateLinkedLocation}
              />
            )}
          </div>

          {/* Lore Tab */}
          <div
            style={{
              display: activeTab === "lore" ? "flex" : "none",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {/* World Lore Nodes */}
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
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  className="sidebar-label"
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <BookOpen size={13} color="var(--accent-violet)" />
                  World Lore Nodes — Hybrid GraphRAG ({loreNodes.length})
                </span>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                  onClick={() => {
                    setLoreNodes([
                      ...loreNodes,
                      {
                        id: `new_lore_${Date.now()}`,
                        world_id: world.id,
                        title: "New Lore Entry",
                        category: "faction",
                        content: "Describe faction, history, rule, or item...",
                        entity_tags: [],
                      },
                    ]);
                    markDirty();
                  }}
                >
                  <Plus size={12} /> Add Lore Node
                </button>
              </div>

              {loreNodes.length === 0 ? (
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  No world lore nodes indexed. Add lore nodes to enrich GraphRAG retrieval with factions, history, and world rules.
                </div>
              ) : (
                loreNodes.map((lore, idx) => (
                  <div
                    key={lore.id}
                    style={{
                      background: "var(--bg-panel)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 6,
                      padding: 10,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1.2fr 130px 1.2fr auto",
                        gap: 8,
                        alignItems: "start",
                      }}
                    >
                      <ClickToEditField
                        label="Lore Title"
                        value={lore.title}
                        onChange={(val) => {
                          const next = [...loreNodes];
                          next[idx] = { ...next[idx], title: val };
                          setLoreNodes(next);
                          markDirty();
                        }}
                      />
                      <div className="field-group">
                        <label>Category</label>
                        <select
                          className="field-select"
                          value={lore.category}
                          onChange={(e) => {
                            const next = [...loreNodes];
                            next[idx] = {
                              ...next[idx],
                              category: e.target.value,
                            };
                            setLoreNodes(next);
                            markDirty();
                          }}
                        >
                          <option value="faction">faction</option>
                          <option value="history">history</option>
                          <option value="item">item</option>
                          <option value="culture">culture</option>
                          <option value="rule">rule</option>
                          <option value="rumor">rumor</option>
                        </select>
                      </div>
                      <ClickToEditField
                        label="Entity Trigger Tags (comma-separated)"
                        value={lore.entity_tags.join(", ")}
                        onChange={(val) => {
                          const next = [...loreNodes];
                          next[idx] = {
                            ...next[idx],
                            entity_tags: val
                              .split(",")
                              .map((t) => t.trim())
                              .filter(Boolean),
                          };
                          setLoreNodes(next);
                          markDirty();
                        }}
                      />
                      <button
                        type="button"
                        className="item-remove-btn"
                        style={{ marginTop: 22 }}
                        onClick={() => {
                          setLoreNodes(loreNodes.filter((_, i) => i !== idx));
                          markDirty();
                        }}
                        title="Remove lore node"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    <ClickToEditField
                      label="Lore Content"
                      value={lore.content}
                      multiline
                      rows={2}
                      onChange={(val) => {
                        const next = [...loreNodes];
                        next[idx] = { ...next[idx], content: val };
                        setLoreNodes(next);
                        markDirty();
                      }}
                    />
                  </div>
                ))
              )}
            </div>
          </div>

          {error && <div style={{ color: "#fda4af" }}>{error}</div>}
        </div>

        <div className="modal-footer">
          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
            {isDirty
              ? "Unsaved edits ready. Saving preserves existing campaigns via silent versioning."
              : "Click any field above to edit."}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className="btn" onClick={onClose}>
              {isDirty ? "Cancel" : "Close"}
            </button>
            {isDirty && (
              <button
                type="button"
                className="btn btn-amber"
                disabled={saving}
                onClick={handleSave}
              >
                <Check size={14} />
                {saving ? "Saving..." : "Save Changes"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
