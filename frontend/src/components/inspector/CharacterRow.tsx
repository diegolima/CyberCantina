import React, { useId } from "react";
import { ChevronDown, ChevronRight, MapPin } from "lucide-react";
import { CharacterRecord, CharacterStateSnapshot } from "../../types";
import { ChangeDot, MiniMoodBars, usePersistentState } from "./InspectorPrimitives";

interface CharacterRowProps {
  character: CharacterRecord;
  state: CharacterStateSnapshot;
  /** False when the character is elsewhere in the world. */
  isPresent: boolean;
  /** Name of the character's current location when not present. */
  elsewhereLocationName?: string;
  /** Whether the mood shifted on the latest turn. */
  moodChanged?: boolean;
}

/** Collapsible "Name · Mood" row expanding into the full affective & goal state. */
export const CharacterRow: React.FC<CharacterRowProps> = ({
  character,
  state,
  isPresent,
  elsewhereLocationName,
  moodChanged,
}) => {
  const [open, setOpen] = usePersistentState<boolean>(
    `character.${character.id}`,
    false
  );
  const bodyId = useId();
  const valencePct = Math.round(((state.valence + 1) / 2) * 100);
  const arousalPct = Math.round(state.arousal * 100);
  const inventory = state.inventory ?? [];
  const relationships = Object.entries(state.relationship_notes || {});

  return (
    <div className={`char-row ${isPresent ? "" : "char-row-absent"}`}>
      <button
        type="button"
        className="char-row-header"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="char-row-identity">
          <span className="char-row-chevron">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <span className="char-row-text">
            <span className="char-row-name-line">
              <span className="char-row-name">{character.name}</span>
              {moodChanged && !open && <ChangeDot title="Mood shifted this turn" />}
            </span>
            <span className="char-row-mood" title={state.mood_label}>
              {state.mood_label}
            </span>
            {!isPresent && (
              <span className="char-row-elsewhere">
                <MapPin size={10} />
                Elsewhere{elsewhereLocationName ? ` · ${elsewhereLocationName}` : ""}
              </span>
            )}
          </span>
        </span>
        <MiniMoodBars valence={state.valence} arousal={state.arousal} />
      </button>

      {open && (
        <div id={bodyId} className="char-row-body">
          <div className="meter-row">
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.73rem" }}>
              <span>Valence (Distressed ↔ Warm)</span>
              <span>
                {state.valence >= 0 ? `+${state.valence.toFixed(2)}` : state.valence.toFixed(2)}
              </span>
            </div>
            <div className="meter-track">
              <div
                className="meter-fill"
                style={{
                  width: `${valencePct}%`,
                  background:
                    state.valence >= 0 ? "var(--accent-emerald)" : "var(--accent-rose)",
                }}
              />
            </div>
          </div>

          <div className="meter-row">
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.73rem" }}>
              <span>Arousal / Tension</span>
              <span>{state.arousal.toFixed(2)}</span>
            </div>
            <div className="meter-track">
              <div
                className="meter-fill"
                style={{ width: `${arousalPct}%`, background: "var(--accent-amber)" }}
              />
            </div>
          </div>

          <div
            style={{
              marginTop: 10,
              display: "flex",
              flexDirection: "column",
              gap: 7,
              fontSize: "0.76rem",
            }}
          >
            <div className="cog-step">
              <div className="cog-step-label">Active Scene Want</div>
              <div>{state.active_want}</div>
            </div>
            <div className="cog-step">
              <div className="cog-step-label">Active Tactical Plan</div>
              <div>{state.active_plan}</div>
            </div>
            <div className="cog-step">
              <div className="cog-step-label">Core Drive &amp; Fear</div>
              <div>
                <strong>Drive:</strong> {character.baseline_psyche.core_drive}
                <br />
                <strong>Fear:</strong> {character.baseline_psyche.core_fear}
              </div>
            </div>
            {character.physical_appearance && (
              <div className="cog-step">
                <div className="cog-step-label">Physical Appearance (Zone 1)</div>
                <div>{character.physical_appearance}</div>
              </div>
            )}
            <div className="cog-step">
              <div className="cog-step-label">Live Inventory &amp; Attire ({inventory.length})</div>
              {inventory.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                  {inventory.map((item, idx) => {
                    const isWorn = /^\[worn\]/i.test(item.trim());
                    return (
                      <span
                        key={idx}
                        className="badge"
                        style={{
                          fontSize: "0.68rem",
                          padding: "2px 6px",
                          borderColor: isWorn
                            ? "rgba(245, 158, 11, 0.45)"
                            : "var(--border-subtle)",
                          color: isWorn ? "var(--accent-amber)" : "var(--text-primary)",
                        }}
                      >
                        {item}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <div style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Empty</div>
              )}
            </div>
            {relationships.length > 0 && (
              <div className="cog-step">
                <div className="cog-step-label">Relationship &amp; Trust Notes</div>
                <div>
                  {relationships.map(([k, v]) => (
                    <div key={k}>
                      <strong>{k}:</strong> {v}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
