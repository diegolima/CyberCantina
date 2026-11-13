import React, { useState } from "react";
import {
  Brain,
  Check,
  Database,
  Eye,
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
  CharacterBaseTab,
  CharacterAppearanceTab,
  CharacterPersonalityTab,
  CharacterVoiceTab,
} from "./character";
import { TagChipsInput } from "./TagChipsInput";

import {
  inferClientDemographicsAndEthics,
  resolveGenreFallbackProfile,
} from "./wizard/genreFallbacks";
export { WorldWizardModal } from "./wizard/WorldWizardModal";

export interface CharacterWizardModalProps {
  worlds: WorldRecord[];
  defaultWorldId: string;
  onClose: () => void;
  onCreated: (char: CharacterRecord, launchWorldId?: string | null) => void;
  initialDraft?: CharacterWizardDraft | null;
  initialPreassignedId?: string | null;
  initialWorldDraft?: WorldWizardDraft | null;
  initialMediaWarning?: string | null;
}

export const CharacterWizardModal: React.FC<CharacterWizardModalProps> = ({
  worlds,
  defaultWorldId,
  onClose,
  onCreated,
  initialDraft = null,
  initialPreassignedId = null,
  initialWorldDraft = null,
  initialMediaWarning = null,
}) => {
  const [name, setName] = useState("Soren Kael");
  const [archetype, setArchetype] = useState(
    "Rogue corporate courier with an encrypted memory vault"
  );
  const [roleInStory, setRoleInStory] = useState(
    "High-stakes informant seeking safe passage"
  );
  const [personalityKeywords, setPersonalityKeywords] = useState<string[]>([
    "paranoid",
    "razor-sharp",
    "dryly funny",
    "loyal",
  ]);
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
  const [launchCampaignImmediately, setLaunchCampaignImmediately] = useState<boolean>(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mediaWarning, setMediaWarning] = useState<string | null>(initialMediaWarning);

  const handleManualCreate = () => {
    const kwList = personalityKeywords.filter(Boolean);
    const selectedWorld = worlds.find((w) => w.id === worldId);
    const worldGenre = selectedWorld?.global_rules?.genre || "";

    const genreProfile = resolveGenreFallbackProfile(worldGenre, archetype, roughNotes);
    const demo = inferClientDemographicsAndEthics(name, archetype, roughNotes);

    const mannerisms = [
      "Clenches jaw and briefly slows breathing when under sudden pressure",
      "Habitually sweeps gaze toward entrances and tracks weapon hands before speaking",
      "Subtly taps fingertips against thigh in measured four-beat intervals when calculating odds",
      "Pauses deliberately before answering direct personal inquiries, holding unbroken eye contact",
    ];

    const traitsList = kwList.length >= 4 ? kwList : [...kwList, "hyper-observant", "cynical", "calculating"].slice(0, 5);

    const features = [...genreProfile.distinctiveFeatures];
    if (!features.some((f) => f.toLowerCase().includes("build") || f.toLowerCase().includes("frame"))) {
      features[0] = demo.build;
    }

    const manualDraft: CharacterWizardDraft = {
      name: name.trim() || "New Character",
      tagline: archetype.trim() || "Independent Operative",
      character_bio: roughNotes.trim() || `${name} is an active ${archetype}.`,
      physical_appearance: roughNotes.trim() || `${name} is an active ${archetype}.`,
      species: demo.species,
      sex: demo.sex,
      pronouns: demo.pronouns,
      age: demo.age,
      build_and_height: demo.buildAndHeight,
      distinctive_features: features,
      posture: demo.posture,
      mannerisms: mannerisms,
      modifications: [],
      visual_aesthetic: genreProfile.visualAesthetic,
      personality_traits: traitsList,
      core_persona: `${name.trim() || "New Character"} is a ${archetype.trim() || "character"}, serving as ${roleInStory.trim() || "a key figure"}. In conversation, they avoid melodrama, preferring grounded observations and subtext-heavy dialogue.`,
      moral_code: demo.moralCode,
      quirks_flaws: demo.quirksFlaws,
      communication_style: ["direct", "measured", "guarded"],
      initial_message: `*${name.trim() || "The character"} pauses, observing you with a measured, attentive gaze.*\n\n"What brings you here?"`,
      equipped: genreProfile.equipped,
      inventory: genreProfile.inventory,
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
        default_plan: "- Observe the immediate threshold and identify all viable exit paths.\n- Test the user's motives with a measured, probing question.\n- Maintain tactical distance and safeguard autonomy until reliability is proven.",
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
        personality_keywords: personalityKeywords,
        rough_notes: roughNotes,
        world_id: worldId || null,
      });
      setDraft(res);
      setPreassignedCharId(null);
      setImportedWorldDraft(null);
      setMediaWarning(null);
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
        onCreated(
          created,
          launchCampaignImmediately ? createdWorld.id : null
        );
      } else {
        const created = await api.commitCharacter(
          draft,
          worldId,
          preassignedCharId
        );
        onCreated(
          created,
          launchCampaignImmediately ? worldId : null
        );
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

          {mediaWarning && (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                background: "rgba(245, 158, 11, 0.1)",
                border: "1px solid rgba(245, 158, 11, 0.35)",
                color: "var(--accent-amber)",
                fontSize: "0.78rem",
              }}
            >
              <strong>Media Quota Notice:</strong> {mediaWarning}
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
                    <label>Personality Keywords &amp; Traits</label>
                    <TagChipsInput
                      value={personalityKeywords}
                      placeholder="e.g. paranoid, razor-sharp, loyal (press comma or enter)"
                      accentVariant="violet"
                      onChange={setPersonalityKeywords}
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
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, marginTop: 4 }}>
                          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Trigger Keywords:</span>
                          {m.keywords.map((kw, ki) => (
                            <span
                              key={ki}
                              className="badge"
                              style={{
                                fontSize: "0.68rem",
                                padding: "1px 6px",
                                background: "rgba(168, 85, 247, 0.12)",
                                borderColor: "rgba(168, 85, 247, 0.3)",
                                color: "var(--accent-violet)",
                              }}
                            >
                              {kw}
                            </span>
                          ))}
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

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
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
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: "0.8rem",
                      color: "var(--text-secondary)",
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={launchCampaignImmediately}
                      onChange={(e) => setLaunchCampaignImmediately(e.target.checked)}
                      style={{ accentColor: "var(--accent-amber)" }}
                    />
                    Immediately start a campaign
                  </label>
                  <button
                    type="button"
                    className="btn btn-amber"
                    onClick={handleCommit}
                    disabled={loading}
                  >
                    <Check size={15} />
                    {loading ? "Saving..." : "Save Character"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
