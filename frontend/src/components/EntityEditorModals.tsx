import React, { useState } from "react";
import {
  BookOpen,
  Check,
  Compass,
  Edit3,
  Globe,
  HeartPulse,
  MapPin,
  Plus,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { api } from "../api";
import {
  CharacterRecord,
  LocationEdge,
  LocationNode,
  LoreNode,
  MemoryShard,
  VoiceAnchor,
  WorldRecord,
} from "../types";

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

export const CharacterInspectorModal: React.FC<
  CharacterInspectorModalProps
> = ({ character, worlds, onClose, onSaved }) => {
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
            Character Sheet — {name}
          </span>
          <button type="button" className="btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
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
            label="Core Persona (Zone 1 Static Demeanor, Psychology & Speech Habits)"
            value={corePersona}
            multiline
            rows={5}
            onChange={(val) => {
              setCorePersona(val);
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

          {/* Starting Inventory (Clothes & Carried Objects) */}
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
                Starting Inventory — Worn Attire & Carried Objects ({inventory.length})
              </span>
              <button
                type="button"
                className="btn"
                style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                onClick={() => {
                  setInventory([...inventory, "[Worn] New attire or item"]);
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
                No starting items or clothing specified.
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
                      placeholder="e.g. [Worn] Leather jacket, or Diagnostic scanner"
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

            {voiceAnchors.map((va, idx) => (
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
                      setVoiceAnchors(voiceAnchors.filter((_, i) => i !== idx));
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
            ))}
          </div>

          {/* Backstory Memory Shards */}
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

            {memoryShards.map((shard, idx) => (
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
                      setMemoryShards(memoryShards.filter((_, i) => i !== idx));
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
            ))}
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

export const WorldInspectorModal: React.FC<WorldInspectorModalProps> = ({
  world,
  onClose,
  onSaved,
}) => {
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
    setLocations(
      locations.map((loc) => ({
        ...loc,
        is_starting_location: loc.id === targetLocId,
      }))
    );
    markDirty();
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
        style={{ width: "min(860px, 95vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Globe size={18} color="var(--accent-cyan)" />
            World & Spatial Graph — {name}
          </span>
          <button type="button" className="btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
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

          {/* Spatial Graph Locations */}
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
                <MapPin size={13} color="var(--accent-amber)" />
                Spatial Graph Locations ({locations.length})
              </span>
              <button
                type="button"
                className="btn"
                style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                onClick={() => {
                  const newId = `new_loc_${Date.now()}`;
                  setLocations([
                    ...locations,
                    {
                      id: newId,
                      world_id: world.id,
                      name: "New Location",
                      summary: "1-sentence exit hook...",
                      description:
                        "Sensory description when inside this location...",
                      environmental_tags: [],
                      is_starting_location: locations.length === 0,
                    },
                  ]);
                  markDirty();
                }}
              >
                <Plus size={12} /> Add Location
              </button>
            </div>

            {locations.map((loc, idx) => (
              <div
                key={loc.id}
                style={{
                  background: "var(--bg-panel)",
                  border: loc.is_starting_location
                    ? "1px solid rgba(245, 158, 11, 0.45)"
                    : "1px solid var(--border-subtle)",
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
                    gridTemplateColumns: "1fr 1fr auto auto",
                    gap: 8,
                    alignItems: "start",
                  }}
                >
                  <ClickToEditField
                    label="Location Name"
                    value={loc.name}
                    onChange={(val) => {
                      const next = [...locations];
                      next[idx] = { ...next[idx], name: val };
                      setLocations(next);
                      markDirty();
                    }}
                  />
                  <ClickToEditField
                    label="Environmental Tags (comma-separated)"
                    value={loc.environmental_tags.join(", ")}
                    onChange={(val) => {
                      const next = [...locations];
                      next[idx] = {
                        ...next[idx],
                        environmental_tags: val
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean),
                      };
                      setLocations(next);
                      markDirty();
                    }}
                  />
                  <button
                    type="button"
                    className={`btn ${
                      loc.is_starting_location ? "btn-amber" : ""
                    }`}
                    style={{ marginTop: 21, padding: "5px 8px", fontSize: "0.72rem" }}
                    onClick={() => handleSetStartingLocation(loc.id)}
                    title="Set as initial starting location for new campaigns"
                  >
                    {loc.is_starting_location ? "Starting Hub" : "Set Start"}
                  </button>
                  {locations.length > 1 && (
                    <button
                      type="button"
                      className="item-remove-btn"
                      style={{ marginTop: 23 }}
                      onClick={() => {
                        const remaining = locations.filter(
                          (_, i) => i !== idx
                        );
                        setLocations(remaining);
                        setEdges(
                          edges.filter(
                            (e) =>
                              e.from_location_id !== loc.id &&
                              e.to_location_id !== loc.id
                          )
                        );
                        markDirty();
                      }}
                      title="Remove location"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>

                <ClickToEditField
                  label="1-Sentence Neighbor Exit Summary"
                  value={loc.summary}
                  onChange={(val) => {
                    const next = [...locations];
                    next[idx] = { ...next[idx], summary: val };
                    setLocations(next);
                    markDirty();
                  }}
                />

                <ClickToEditField
                  label="Full Sensory Description"
                  value={loc.description}
                  multiline
                  rows={2}
                  onChange={(val) => {
                    const next = [...locations];
                    next[idx] = { ...next[idx], description: val };
                    setLocations(next);
                    markDirty();
                  }}
                />
              </div>
            ))}
          </div>

          {/* Spatial Graph Edges / Passages */}
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
                <Compass size={13} color="var(--accent-cyan)" />
                Spatial Graph Passages & Connections ({edges.length})
              </span>
              {locations.length >= 2 && (
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                  onClick={() => {
                    setEdges([
                      ...edges,
                      {
                        id: `new_edge_${Date.now()}`,
                        world_id: world.id,
                        from_location_id: locations[0].id,
                        to_location_id: locations[1].id,
                        direction_label: "Passageway",
                        travel_minutes: 2,
                        is_locked_or_hidden: false,
                      },
                    ]);
                    markDirty();
                  }}
                >
                  <Plus size={12} /> Add Passage
                </button>
              )}
            </div>

            {edges.map((edge, idx) => (
              <div
                key={edge.id}
                style={{
                  background: "var(--bg-panel)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 6,
                  padding: 10,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1.4fr 80px auto",
                  gap: 8,
                  alignItems: "start",
                }}
              >
                <div className="field-group">
                  <label>From</label>
                  <select
                    className="field-select"
                    value={edge.from_location_id}
                    onChange={(e) => {
                      const next = [...edges];
                      next[idx] = {
                        ...next[idx],
                        from_location_id: e.target.value,
                      };
                      setEdges(next);
                      markDirty();
                    }}
                  >
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field-group">
                  <label>To</label>
                  <select
                    className="field-select"
                    value={edge.to_location_id}
                    onChange={(e) => {
                      const next = [...edges];
                      next[idx] = {
                        ...next[idx],
                        to_location_id: e.target.value,
                      };
                      setEdges(next);
                      markDirty();
                    }}
                  >
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>

                <ClickToEditField
                  label="Passage / Direction Label"
                  value={edge.direction_label}
                  onChange={(val) => {
                    const next = [...edges];
                    next[idx] = { ...next[idx], direction_label: val };
                    setEdges(next);
                    markDirty();
                  }}
                />

                <div className="field-group">
                  <label>Minutes</label>
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    className="field-input"
                    value={edge.travel_minutes}
                    onChange={(e) => {
                      const next = [...edges];
                      next[idx] = {
                        ...next[idx],
                        travel_minutes: Math.max(0, Number(e.target.value) || 0),
                      };
                      setEdges(next);
                      markDirty();
                    }}
                  />
                </div>

                <button
                  type="button"
                  className="item-remove-btn"
                  style={{ marginTop: 22 }}
                  onClick={() => {
                    setEdges(edges.filter((_, i) => i !== idx));
                    markDirty();
                  }}
                  title="Remove passage"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>

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

            {loreNodes.map((lore, idx) => (
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
                        next[idx] = { ...next[idx], category: e.target.value };
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
            ))}
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
