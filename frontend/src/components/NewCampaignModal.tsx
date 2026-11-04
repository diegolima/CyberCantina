import React, { useState } from "react";
import { FolderPlus, Lock, Plus, Sparkles, UserCheck, X } from "lucide-react";
import { CharacterRecord, PersonaRecord, WorldRecord } from "../types";

export interface NewCampaignModalProps {
  worlds: WorldRecord[];
  characters: CharacterRecord[];
  personas: PersonaRecord[];
  initialWorldId?: string;
  initialCharacterId?: string;
  initialPersonaId?: string;
  onClose: () => void;
  onCreate: (payload: {
    name: string;
    world_id: string;
    character_id: string;
    persona_id?: string;
  }) => Promise<void>;
  onOpenPersonaModal?: () => void;
}

export const NewCampaignModal: React.FC<NewCampaignModalProps> = ({
  worlds,
  characters,
  personas,
  initialWorldId,
  initialCharacterId,
  initialPersonaId,
  onClose,
  onCreate,
  onOpenPersonaModal,
}) => {
  const [selectedWorldId, setSelectedWorldId] = useState(
    initialWorldId || worlds[0]?.id || ""
  );
  const [selectedCharId, setSelectedCharId] = useState(
    initialCharacterId || characters[0]?.id || ""
  );
  const [selectedPersonaId, setSelectedPersonaId] = useState(
    initialPersonaId || (personas.length > 0 ? personas[0].id : "")
  );

  const selectedWorld = worlds.find((w) => w.id === selectedWorldId) || worlds[0];
  const selectedChar = characters.find((c) => c.id === selectedCharId) || characters[0];
  const selectedPersona = personas.find((p) => p.id === selectedPersonaId) || null;

  const defaultName = `${selectedChar?.name ?? "Hero"} in ${selectedWorld?.name ?? "World"}`;
  const [campaignName, setCampaignName] = useState(defaultName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleWorldChange = (worldId: string) => {
    setSelectedWorldId(worldId);
    const w = worlds.find((item) => item.id === worldId);
    if (w && selectedChar) {
      setCampaignName(`${selectedChar.name} in ${w.name}`);
    }
  };

  const handleCharChange = (charId: string) => {
    setSelectedCharId(charId);
    const c = characters.find((item) => item.id === charId);
    if (c && selectedWorld) {
      setCampaignName(`${c.name} in ${selectedWorld.name}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWorldId || !selectedCharId) {
      setErrorMsg("Please select both a world and a primary character.");
      return;
    }
    const finalName = campaignName.trim() || defaultName;
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await onCreate({
        name: finalName,
        world_id: selectedWorldId,
        character_id: selectedCharId,
        persona_id: selectedPersonaId ? selectedPersonaId : undefined,
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to start campaign.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-panel" style={{ width: "min(560px, 94vw)" }}>
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent-emerald)" }}>
            <FolderPlus size={18} />
            Start New Campaign
          </span>
          <button type="button" className="btn" onClick={onClose} disabled={isSubmitting}>
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {errorMsg && (
            <div style={{ color: "#fda4af", fontSize: "0.82rem", background: "rgba(239, 68, 68, 0.1)", padding: "6px 10px", borderRadius: 4 }}>
              {errorMsg}
            </div>
          )}

          <div>
            <label style={{ fontSize: "0.82rem", fontWeight: 600, display: "block", marginBottom: 4 }}>
              Campaign Title
            </label>
            <input
              type="text"
              className="field-input"
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder="e.g. Neon Shadows in Night City"
              required
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: "0.82rem", fontWeight: 600, display: "block", marginBottom: 4 }}>
                World
              </label>
              <select
                className="field-select"
                value={selectedWorldId}
                onChange={(e) => handleWorldChange(e.target.value)}
                required
              >
                {worlds.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.locations.length} locations)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: "0.82rem", fontWeight: 600, display: "block", marginBottom: 4 }}>
                Primary Character (Companion / NPC)
              </label>
              <select
                className="field-select"
                value={selectedCharId}
                onChange={(e) => handleCharChange(e.target.value)}
                required
              >
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <label style={{ fontSize: "0.82rem", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                <UserCheck size={14} color="var(--accent-emerald)" />
                Player Persona (Your Identity)
              </label>
              {onOpenPersonaModal && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    onClose();
                    onOpenPersonaModal();
                  }}
                  style={{ fontSize: "0.72rem", padding: "2px 8px", display: "flex", alignItems: "center", gap: 4 }}
                >
                  <Plus size={12} />
                  New Persona
                </button>
              )}
            </div>

            <select
              className="field-select"
              value={selectedPersonaId}
              onChange={(e) => setSelectedPersonaId(e.target.value)}
            >
              <option value="">None (Standard Anonymous Protagonist)</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.age ? `(Age ${p.age})` : ""} — {p.inventory?.length ?? 0} items, {p.lore_entries?.length ?? 0} lore
                </option>
              ))}
            </select>
          </div>

          {selectedPersona ? (
            <div
              style={{
                background: "rgba(16, 185, 129, 0.05)",
                border: "1px solid rgba(16, 185, 129, 0.2)",
                borderRadius: 6,
                padding: "10px 12px",
                fontSize: "0.78rem",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <strong style={{ color: "var(--accent-emerald)" }}>{selectedPersona.name}</strong>
                <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
                  Snapshot will be permanently frozen for this campaign
                </span>
              </div>
              <div style={{ color: "var(--text-secondary)", lineHeight: 1.4 }}>
                {selectedPersona.physical_appearance || "No physical appearance specified."}
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 2, color: "var(--text-muted)", fontSize: "0.72rem" }}>
                <span>Equipped: {selectedPersona.equipped?.length ?? 0} (Public)</span>
                <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <Lock size={10} /> Inventory: {selectedPersona.inventory?.length ?? 0} (Secret)
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <Lock size={10} /> Lore: {selectedPersona.lore_entries?.length ?? 0} (Secret)
                </span>
              </div>
            </div>
          ) : (
            <div
              style={{
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px dashed var(--border-subtle)",
                borderRadius: 6,
                padding: "8px 12px",
                fontSize: "0.75rem",
                color: "var(--text-muted)",
              }}
            >
              No persona selected. The campaign will run with the default anonymous protagonist view.
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 6 }}>
            <button type="button" className="btn" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSubmitting || !selectedWorldId || !selectedCharId}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <Sparkles size={14} />
              {isSubmitting ? "Starting..." : "Start Campaign"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
