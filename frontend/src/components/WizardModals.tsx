import React, { useMemo, useState } from "react";
import {
  Brain,
  Check,
  Database,
  Eye,
  Globe,
  MessageSquare,
  Package,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  User,
  UserPlus,
  X,
} from "lucide-react";
import { api } from "../api";
import {
  CharacterRecord,
  CharacterWizardDraft,
  WorldRecord,
  WorldWizardDraft,
  normalizeItemInstance,
} from "../types";
import {
  WorldInspectorModal,
  draftToWorldRecord,
  worldStateToDraft,
} from "./EntityEditorModals";
import {
  CharacterBaseTab,
  CharacterAppearanceTab,
  CharacterPersonalityTab,
  CharacterVoiceTab,
} from "./character";

export interface CharacterWizardModalProps {
  worlds: WorldRecord[];
  defaultWorldId: string;
  onClose: () => void;
  onCreated: (char: CharacterRecord, launchWorldId: string) => void;
  initialDraft?: CharacterWizardDraft | null;
  initialPreassignedId?: string | null;
  initialWorldDraft?: WorldWizardDraft | null;
}

export const CharacterWizardModal: React.FC<CharacterWizardModalProps> = ({
  worlds,
  defaultWorldId,
  onClose,
  onCreated,
  initialDraft = null,
  initialPreassignedId = null,
  initialWorldDraft = null,
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

  const [preassignedCharId, setPreassignedCharId] = useState<string | null>(initialPreassignedId);
  const [importedWorldDraft, setImportedWorldDraft] = useState<WorldWizardDraft | null>(initialWorldDraft);

  const [draft, setDraft] = useState<CharacterWizardDraft | null>(initialDraft);
  const [draftTab, setDraftTab] = useState<
    "base" | "appearance" | "personality" | "voice" | "inventory" | "memories"
  >("base");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleManualCreate = () => {
    const kwList = keywords
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const manualDraft: CharacterWizardDraft = {
      name: name.trim() || "New Character",
      tagline: archetype.trim() || "Independent Operative",
      character_bio: roughNotes.trim() || `${name} is a ${archetype}.`,
      physical_appearance: roughNotes.trim() || `${name} is a ${archetype}.`,
      species: "Human",
      sex: "",
      pronouns: "",
      age: "",
      build_and_height: "",
      distinctive_features: [],
      posture: "",
      mannerisms: [],
      modifications: [],
      visual_aesthetic: "",
      personality_traits: kwList,
      core_persona: `${name.trim() || "New Character"} is a ${archetype.trim() || "character"}, serving as ${roleInStory.trim() || "a key figure"}.`,
      moral_code: [],
      quirks_flaws: [],
      communication_style: ["direct"],
      initial_message: `*${name.trim() || "The character"} pauses, observing you with a measured, attentive gaze.*\n\n"What brings you here?"`,
      equipped: [
        normalizeItemInstance("Practical street jacket"),
        normalizeItemInstance("Dark utility trousers"),
      ],
      inventory: [normalizeItemInstance("Personal comm-link")],
      voice_anchors: [
        {
          context: "Calm / Conversational",
          snippet: `*${name.trim() || "They"} speak in an unhurried, measured cadence.* "Tell me what's actually on your mind."`,
        },
      ],
      baseline_psyche: {
        mood_label: "Calm & Composed",
        valence: 0.2,
        arousal: 0.2,
        core_drive: `Pursue goals as a ${archetype.trim() || "character"} while maintaining independence.`,
        core_fear: "Losing autonomy or being compromised by past events.",
        default_want: `Assess the situation and establish their dynamic as ${roleInStory.trim() || "an ally"}.`,
        default_plan: "Engage in direct conversation and gauge the user's intent.",
        temperament: {
          archetype: "balanced",
          relational_inertia: 0.8,
          negativity_ratio: 3.5,
          theta_pos_base: 0.15,
          theta_neg_base: -0.12,
          composure_resilience: 1.0,
        },
        initial_worldview: {
          benevolence: 0.0,
          belonging: 0.1,
          agency: 0.2,
        },
      },
      memory_shards: [
        {
          id: "shard_seed_0",
          title: "Origins & Background",
          content: roughNotes.trim() || `${name} began their journey in this region.`,
          keywords: ["backstory", "origin"],
          emotional_weight: 0.7,
        },
      ],
      tags: kwList,
      creator: "",
      creator_notes: roughNotes.trim(),
      portraits: {},
      gallery: [],
    };
    setDraft(manualDraft);
    setPreassignedCharId(null);
    setImportedWorldDraft(null);
  };

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
      setPreassignedCharId(null);
      setImportedWorldDraft(null);
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
      if (importedWorldDraft) {
        const createdWorld = await api.commitWorld(importedWorldDraft);
        const created = await api.commitCharacter(
          draft,
          createdWorld.id,
          preassignedCharId
        );
        onCreated(created, createdWorld.id);
      } else {
        const created = await api.commitCharacter(
          draft,
          worldId,
          preassignedCharId
        );
        onCreated(created, worldId);
      }
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

              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: 4 }}>
                Looking to import an existing character card (.png / .json) or .zcc archive? Use <strong>Import</strong> on the Home Screen.
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
                <button type="button" className="btn" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={handleManualCreate}
                >
                  <Pencil size={15} />
                  Manually Create Character
                </button>
                <button
                  type="submit"
                  className="btn btn-amber"
                  disabled={loading}
                >
                  <Sparkles size={15} />
                  {loading ? "AI Expanding Character..." : "Expand & Optimize with AI"}
                </button>
              </div>
            </form>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Media Preview Banner if Portrait Present */}
              {draft.portraits?.default && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "10px 14px",
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 8,
                  }}
                >
                  <img
                    src={draft.portraits.default}
                    alt={draft.name}
                    style={{
                      width: 60,
                      height: 60,
                      borderRadius: 8,
                      objectFit: "cover",
                      border: "1px solid var(--border-subtle)",
                    }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--accent-amber)", fontSize: "0.95rem" }}>
                      {draft.name}
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                      {draft.tagline}
                    </div>
                    {draft.gallery && draft.gallery.length > 0 && (
                      <div style={{ fontSize: "0.74rem", color: "var(--accent-cyan)", marginTop: 2 }}>
                        Photo album initialized with {draft.gallery.length} artwork asset(s)
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Auto-Generated World Notice */}
              {importedWorldDraft && (
                <div
                  style={{
                    padding: "10px 14px",
                    background: "rgba(56, 189, 248, 0.08)",
                    border: "1px solid var(--accent-cyan)",
                    borderRadius: 8,
                    fontSize: "0.82rem",
                  }}
                >
                  <strong style={{ color: "var(--accent-cyan)" }}>Auto-Generated World: </strong>
                  <span>
                    "{importedWorldDraft.name}" ({importedWorldDraft.locations.length} interconnected locations) will be launched with this character.
                  </span>
                </div>
              )}

              {/* Modal Tabs for Draft Preview & Fine-Grained Editing */}
              <div className="modal-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={draftTab === "base"}
                  className={`modal-tab-btn ${draftTab === "base" ? "active" : ""}`}
                  onClick={() => setDraftTab("base")}
                >
                  <User size={14} />
                  <span>Base</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={draftTab === "appearance"}
                  className={`modal-tab-btn ${draftTab === "appearance" ? "active" : ""}`}
                  onClick={() => setDraftTab("appearance")}
                >
                  <Eye size={14} />
                  <span>Appearance</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={draftTab === "personality"}
                  className={`modal-tab-btn ${draftTab === "personality" ? "active" : ""}`}
                  onClick={() => setDraftTab("personality")}
                >
                  <Brain size={14} />
                  <span>Personality</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={draftTab === "voice"}
                  className={`modal-tab-btn ${draftTab === "voice" ? "active" : ""}`}
                  onClick={() => setDraftTab("voice")}
                >
                  <MessageSquare size={14} />
                  <span>Voice &amp; Dialogue</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={draftTab === "inventory"}
                  className={`modal-tab-btn ${draftTab === "inventory" ? "active" : ""}`}
                  onClick={() => setDraftTab("inventory")}
                >
                  <Package size={14} />
                  <span>Inventory</span>
                  <span className="modal-tab-badge">
                    {(draft.equipped ?? []).length + draft.inventory.length}
                  </span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={draftTab === "memories"}
                  className={`modal-tab-btn ${draftTab === "memories" ? "active" : ""}`}
                  onClick={() => setDraftTab("memories")}
                >
                  <Database size={14} />
                  <span>Memories</span>
                  <span className="modal-tab-badge">{draft.memory_shards.length}</span>
                </button>
              </div>

              {/* Tab Content */}
              {draftTab === "base" && (
                <CharacterBaseTab
                  data={draft}
                  onChange={(upd) => setDraft({ ...draft, ...upd })}
                  readOnly={false}
                  worlds={worlds}
                />
              )}

              {draftTab === "appearance" && (
                <CharacterAppearanceTab
                  data={draft}
                  onChange={(upd) => setDraft({ ...draft, ...upd })}
                  readOnly={false}
                />
              )}

              {draftTab === "personality" && (
                <CharacterPersonalityTab
                  data={draft}
                  onChange={(upd) => setDraft({ ...draft, ...upd })}
                  readOnly={false}
                />
              )}

              {draftTab === "voice" && (
                <CharacterVoiceTab
                  data={draft}
                  onChange={(upd) => setDraft({ ...draft, ...upd })}
                  readOnly={false}
                />
              )}

              {draftTab === "inventory" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {/* Equipped Attire */}
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
                        Equipped Attire &amp; Gear ({(draft.equipped ?? []).length})
                      </span>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            equipped: [...(draft.equipped ?? []), "New equipped attire"],
                          })
                        }
                      >
                        <Plus size={12} /> Add Equipped
                      </button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {(draft.equipped ?? []).map((item, idx) => {
                        const itemObj = normalizeItemInstance(item, idx);
                        return (
                          <div
                            key={itemObj.id || idx}
                            style={{ display: "flex", alignItems: "center", gap: 6 }}
                          >
                            <input
                              className="field-input"
                              style={{ flex: 1, padding: "5px 8px", fontSize: "0.78rem" }}
                              value={typeof item === "string" ? item : item.name}
                              placeholder="e.g. Leather jacket"
                              onChange={(e) => {
                                const next = [...(draft.equipped ?? [])];
                                next[idx] =
                                  typeof item === "string"
                                    ? e.target.value
                                    : { ...item, name: e.target.value };
                                setDraft({ ...draft, equipped: next });
                              }}
                            />
                            <button
                              type="button"
                              className="item-remove-btn"
                              onClick={() =>
                                setDraft({
                                  ...draft,
                                  equipped: (draft.equipped ?? []).filter((_, i) => i !== idx),
                                })
                              }
                              title="Remove equipped item"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        );
                      })}
                      {(draft.equipped ?? []).length === 0 && (
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                          No equipped gear specified.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Carried Inventory */}
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
                        Carried Inventory ({draft.inventory.length})
                      </span>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            inventory: [...draft.inventory, "New carried item"],
                          })
                        }
                      >
                        <Plus size={12} /> Add Item
                      </button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {draft.inventory.map((item, idx) => {
                        const itemObj = normalizeItemInstance(item, idx);
                        return (
                          <div
                            key={itemObj.id || idx}
                            style={{ display: "flex", alignItems: "center", gap: 6 }}
                          >
                            <input
                              className="field-input"
                              style={{ flex: 1, padding: "5px 8px", fontSize: "0.78rem" }}
                              value={typeof item === "string" ? item : item.name}
                              placeholder="e.g. Encrypted datapad"
                              onChange={(e) => {
                                const next = [...draft.inventory];
                                next[idx] =
                                  typeof item === "string"
                                    ? e.target.value
                                    : { ...item, name: e.target.value };
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
                        );
                      })}
                      {draft.inventory.length === 0 && (
                        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                          No carried items specified.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {draftTab === "memories" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div className="sidebar-label">
                    Atomic Backstory Memory Shards ({draft.memory_shards.length} — Indexed into Vector Store)
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {draft.memory_shards.map((m, i) => (
                      <div key={i} className="cog-step" style={{ fontSize: "0.78rem", padding: "8px 12px" }}>
                        <div style={{ fontWeight: 600, color: "var(--accent-cyan)", marginBottom: 4 }}>
                          {m.title}
                        </div>
                        <div style={{ color: "var(--text-primary)", marginBottom: 4 }}>
                          {m.content}
                        </div>
                        <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                          Keywords: [{m.keywords.join(", ")}]
                        </div>
                      </div>
                    ))}
                    {draft.memory_shards.length === 0 && (
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                        No backstory memory shards generated.
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setDraft(null);
                    setPreassignedCharId(null);
                    setImportedWorldDraft(null);
                  }}
                >
                  ← Back
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

  const draftWorld = useMemo(
    () => (draft ? draftToWorldRecord(draft) : null),
    [draft]
  );

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
      if (res && res.global_rules) {
        const curGenre = (res.global_rules.genre || "").trim();
        const curLower = curGenre.toLowerCase();
        const intendedLower = genreAndTone.trim().toLowerCase();
        if (
          !curGenre ||
          ((curLower === "cyberpunk noir" || curLower === "cyberpunk") &&
            !intendedLower.includes("cyberpunk"))
        ) {
          res.global_rules.genre = genreAndTone.trim();
        }
      }
      setDraft(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  if (draftWorld) {
    return (
      <WorldInspectorModal
        world={draftWorld}
        mode="wizard"
        onClose={onClose}
        onBackToSeed={() => setDraft(null)}
        onCommitDraft={async (payload) => {
          const nextDraft = worldStateToDraft(payload);
          return api.commitWorld(nextDraft);
        }}
        onSaved={onCreated}
      />
    );
  }

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
        </div>
      </div>
    </div>
  );
};
