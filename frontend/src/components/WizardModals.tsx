import React, { useState } from "react";
import { Sparkles, Globe, UserPlus, X, Check, Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import {
  CharacterRecord,
  CharacterWizardDraft,
  WorldRecord,
  WorldWizardDraft,
} from "../types";

interface CharacterWizardModalProps {
  worlds: WorldRecord[];
  defaultWorldId: string;
  onClose: () => void;
  onCreated: (char: CharacterRecord, launchWorldId: string) => void;
}

export const CharacterWizardModal: React.FC<CharacterWizardModalProps> = ({
  worlds,
  defaultWorldId,
  onClose,
  onCreated,
}) => {
  const [name, setName] = useState("Soren Kael");
  const [archetype, setArchetype] = useState(
    "Rogue corporate courier with an encrypted memory vault"
  );
  const [roleInStory, setRoleInStory] = useState(
    "High-stakes informant seeking safe passage"
  );
  const [keywords, setKeywords] = useState("paranoid, razor-sharp, dryly funny, loyal");
  const [roughNotes, setRoughNotes] = useState(
    "Fled an ambush in the upper spire; carries a locked bio-drive."
  );
  const [worldId, setWorldId] = useState(defaultWorldId);

  const [draft, setDraft] = useState<CharacterWizardDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGenerateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await api.draftCharacter({
        name,
        archetype,
        role_in_story: roleInStory,
        personality_keywords: keywords
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        rough_notes: roughNotes,
        world_id: worldId || null,
      });
      setDraft(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!draft) return;
    setLoading(true);
    try {
      const created = await api.commitCharacter(draft, worldId);
      onCreated(created, worldId);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-panel">
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent-amber)" }}>
            <UserPlus size={18} />
            1.1 Character Creation Wizard (Seed → Expand → Shard into RAG)
          </span>
          <button type="button" className="btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          {error && (
            <div style={{ color: "var(--accent-rose)", fontSize: "0.82rem" }}>
              {error}
            </div>
          )}

          {!draft ? (
            <form onSubmit={handleGenerateDraft} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="field-group">
                <label>Target World Setting</label>
                <select
                  className="field-select"
                  value={worldId}
                  onChange={(e) => setWorldId(e.target.value)}
                >
                  <option value="">Standalone (No specific world)</option>
                  {worlds.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.global_rules.genre})
                    </option>
                  ))}
                </select>
              </div>

              <div className="field-group">
                <label>Character Name</label>
                <input
                  className="field-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="field-group">
                <label>Archetype / High Concept</label>
                <input
                  className="field-input"
                  value={archetype}
                  onChange={(e) => setArchetype(e.target.value)}
                  required
                />
              </div>

              <div className="field-group">
                <label>Role in Story</label>
                <input
                  className="field-input"
                  value={roleInStory}
                  onChange={(e) => setRoleInStory(e.target.value)}
                />
              </div>

              <div className="field-group">
                <label>Personality Keywords (comma-separated)</label>
                <input
                  className="field-input"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                />
              </div>

              <div className="field-group">
                <label>Rough Notes, Secrets, or Backstory Ideas</label>
                <textarea
                  className="field-textarea"
                  value={roughNotes}
                  onChange={(e) => setRoughNotes(e.target.value)}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
                <button type="button" className="btn" onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-amber" disabled={loading}>
                  <Sparkles size={15} />
                  {loading ? "AI Expanding Character..." : "Expand & Optimize with AI"}
                </button>
              </div>
            </form>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="field-group">
                <label>Physical Appearance (Zone 1 Immutable Anatomy & Features)</label>
                <textarea
                  className="field-textarea"
                  rows={3}
                  value={draft.physical_appearance}
                  onChange={(e) =>
                    setDraft({ ...draft, physical_appearance: e.target.value })
                  }
                />
              </div>

              <div className="field-group">
                <label>Expanded Core Persona (Zone 1 Demeanor & Psychology)</label>
                <textarea
                  className="field-textarea"
                  rows={4}
                  value={draft.core_persona}
                  onChange={(e) =>
                    setDraft({ ...draft, core_persona: e.target.value })
                  }
                />
              </div>

              <div className="field-group">
                <label>Initial Message (Turn 0 Opening Scene Prose)</label>
                <textarea
                  className="field-textarea"
                  rows={4}
                  value={draft.initial_message}
                  onChange={(e) =>
                    setDraft({ ...draft, initial_message: e.target.value })
                  }
                />
              </div>

              <div
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 8,
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
                    alignItems: "center",
                  }}
                >
                  <span className="sidebar-label">
                    Starting Inventory — Attire & Objects ({draft.inventory.length})
                  </span>
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        inventory: [...draft.inventory, "[Worn] New attire or item"],
                      })
                    }
                  >
                    <Plus size={12} /> Add Item
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {draft.inventory.map((item, idx) => (
                    <div
                      key={idx}
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <input
                        className="field-input"
                        style={{ flex: 1, padding: "5px 8px", fontSize: "0.78rem" }}
                        value={item}
                        onChange={(e) => {
                          const next = [...draft.inventory];
                          next[idx] = e.target.value;
                          setDraft({ ...draft, inventory: next });
                        }}
                      />
                      <button
                        type="button"
                        className="item-remove-btn"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            inventory: draft.inventory.filter((_, i) => i !== idx),
                          })
                        }
                        title="Remove item"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="cog-step">
                  <div className="cog-step-label">Core Drive</div>
                  <div style={{ fontSize: "0.8rem" }}>{draft.baseline_psyche.core_drive}</div>
                </div>
                <div className="cog-step">
                  <div className="cog-step-label">Core Fear</div>
                  <div style={{ fontSize: "0.8rem" }}>{draft.baseline_psyche.core_fear}</div>
                </div>
              </div>

              <div>
                <div className="sidebar-label">
                  Generated Voice Anchors ({draft.voice_anchors.length})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {draft.voice_anchors.map((v, i) => (
                    <div key={i} className="cog-step" style={{ fontSize: "0.78rem" }}>
                      <strong style={{ color: "var(--accent-amber)" }}>[{v.context}]:</strong>{" "}
                      {v.snippet}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="sidebar-label">
                  Atomic Backstory Memory Shards ({draft.memory_shards.length} — Indexed into Vector Store)
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {draft.memory_shards.map((m, i) => (
                    <div key={i} className="cog-step" style={{ fontSize: "0.78rem" }}>
                      <strong style={{ color: "var(--accent-cyan)" }}>{m.title}:</strong>{" "}
                      {m.content}{" "}
                      <span style={{ color: "var(--text-muted)" }}>
                        [{m.keywords.join(", ")}]
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                <button type="button" className="btn" onClick={() => setDraft(null)}>
                  ← Back to Seed
                </button>
                <button
                  type="button"
                  className="btn btn-amber"
                  onClick={handleCommit}
                  disabled={loading}
                >
                  <Check size={15} />
                  {loading ? "Saving..." : "Commit Character & Launch Campaign"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface WorldWizardModalProps {
  onClose: () => void;
  onCreated: (world: WorldRecord) => void;
}

export const WorldWizardModal: React.FC<WorldWizardModalProps> = ({
  onClose,
  onCreated,
}) => {
  const [name, setName] = useState("Orbital Station Helios-7");
  const [genreAndTone, setGenreAndTone] = useState(
    "Hard Sci-Fi Corporate Thriller / Claustrophobic Noir"
  );
  const [corePremise, setCorePremise] = useState(
    "A quarantined deep-space mining spindle where oxygen is rationed and a rogue AI whispers through the comms."
  );
  const [hubConcept, setHubConcept] = useState(
    "The Low-G Hydroponics Cantina ('The Oxygen Garden')"
  );
  const [locationCount, setLocationCount] = useState(4);

  const [draft, setDraft] = useState<WorldWizardDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGenerateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await api.draftWorld({
        name,
        genre_and_tone: genreAndTone,
        core_premise: corePremise,
        initial_hub_concept: hubConcept,
        location_count: locationCount,
      });
      setDraft(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!draft) return;
    setLoading(true);
    try {
      const created = await api.commitWorld(draft);
      onCreated(created);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-panel">
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent-cyan)" }}>
            <Globe size={18} />
            1.2 World & Spatial Topology Wizard
          </span>
          <button type="button" className="btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-body">
          {error && (
            <div style={{ color: "var(--accent-rose)", fontSize: "0.82rem" }}>
              {error}
            </div>
          )}

          {!draft ? (
            <form onSubmit={handleGenerateDraft} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="field-group">
                <label>World / Scenario Name</label>
                <input
                  className="field-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="field-group">
                <label>Genre & Tone</label>
                <input
                  className="field-input"
                  value={genreAndTone}
                  onChange={(e) => setGenreAndTone(e.target.value)}
                  required
                />
              </div>

              <div className="field-group">
                <label>Core Premise & Conflict</label>
                <textarea
                  className="field-textarea"
                  value={corePremise}
                  onChange={(e) => setCorePremise(e.target.value)}
                  required
                />
              </div>

              <div className="field-group">
                <label>Starting Hub Location Concept</label>
                <input
                  className="field-input"
                  value={hubConcept}
                  onChange={(e) => setHubConcept(e.target.value)}
                />
              </div>

              <div className="field-group">
                <label>Initial Connected Locations (3–8)</label>
                <input
                  type="number"
                  min={3}
                  max={8}
                  className="field-input"
                  value={locationCount}
                  onChange={(e) => setLocationCount(Number(e.target.value))}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
                <button type="button" className="btn" onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-cyan" disabled={loading}>
                  <Sparkles size={15} />
                  {loading ? "Building Spatial Graph..." : "Generate World & Spatial Graph"}
                </button>
              </div>
            </form>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="cog-step">
                <div className="cog-step-label">Global Rules & Tech/Magic Constraints</div>
                <div style={{ fontSize: "0.8rem" }}>
                  <strong>Overview:</strong> {draft.global_rules.setting_overview}
                  <br />
                  <strong>Rules:</strong> {draft.global_rules.tech_or_magic_rules}
                </div>
              </div>

              <div>
                <div className="sidebar-label">
                  Generated Spatial Graph Locations ({draft.locations.length})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {draft.locations.map((loc) => (
                    <div key={loc.key} className="cog-step" style={{ fontSize: "0.78rem" }}>
                      <strong style={{ color: "var(--accent-amber)" }}>
                        {loc.name} {loc.is_starting_location ? "(Starting Hub)" : ""}
                      </strong>
                      : {loc.summary}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="sidebar-label">
                  Spatial Connections ({draft.edges.length} Bidirectional Edges)
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {draft.edges.map((e, idx) => (
                    <div key={idx} style={{ fontSize: "0.76rem", color: "var(--text-secondary)" }}>
                      • <strong>{e.from_key}</strong> ↔ <strong>{e.to_key}</strong> via{" "}
                      <em>"{e.direction_label}"</em> ({e.travel_minutes}m)
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="sidebar-label">
                  World Lore Nodes ({draft.lore_nodes.length})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {draft.lore_nodes.map((l, idx) => (
                    <div key={idx} className="cog-step" style={{ fontSize: "0.76rem" }}>
                      <strong style={{ color: "var(--accent-emerald)" }}>
                        [{l.category}] {l.title}:
                      </strong>{" "}
                      {l.content}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                <button type="button" className="btn" onClick={() => setDraft(null)}>
                  ← Back to Seed
                </button>
                <button
                  type="button"
                  className="btn btn-cyan"
                  onClick={handleCommit}
                  disabled={loading}
                >
                  <Check size={15} />
                  {loading ? "Saving..." : "Commit World & Spatial Graph"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
