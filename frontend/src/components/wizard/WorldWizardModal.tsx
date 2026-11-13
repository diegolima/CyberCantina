import React, { useMemo, useState } from "react";
import { Globe, Sparkles, X } from "lucide-react";
import { api } from "../../api";
import { WorldRecord, WorldWizardDraft } from "../../types";
import {
  WorldInspectorModal,
  draftToWorldRecord,
  worldStateToDraft,
} from "../EntityEditorModals";

export interface WorldWizardModalProps {
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

