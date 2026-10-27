import React, { useId } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleMinus,
  CirclePlus,
  MapPin,
  SlidersHorizontal,
} from "lucide-react";
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
  /** Callback to toggle equipping or unequipping an item (applied next turn) */
  onToggleItemEquip?: (payload: {
    item: string;
    action: "equip" | "unequip" | "remove" | "add";
    target?: "equipped" | "inventory";
    character_id?: string;
  }) => Promise<void> | void;
  /** Open full character sheet dossier modal */
  onOpenSheet?: (characterId: string) => void;
}

/** Collapsible "Name · Mood" row expanding into the affective meters, gear, and "More" sheet. */
export const CharacterRow: React.FC<CharacterRowProps> = ({
  character,
  state,
  isPresent,
  elsewhereLocationName,
  moodChanged,
  onToggleItemEquip,
  onOpenSheet,
}) => {
  const [open, setOpen] = usePersistentState<boolean>(
    `character.${character.id}`,
    false
  );
  const bodyId = useId();
  const valencePct = Math.round(((state.valence + 1) / 2) * 100);
  const arousalPct = Math.round(state.arousal * 100);

  let equippedList = state.equipped ?? [];
  let inventoryList = state.inventory ?? [];
  if (
    equippedList.length === 0 &&
    inventoryList.some((it) => /^\[(?:worn|equipped)\]/i.test(it))
  ) {
    equippedList = inventoryList
      .filter((it) => /^\[(?:worn|equipped)\]/i.test(it))
      .map((it) => it.replace(/^\[(?:worn|equipped)\]\s*/i, ""));
    inventoryList = inventoryList.filter(
      (it) => !/^\[(?:worn|equipped)\]/i.test(it)
    );
  }

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
          {/* Valence Meter */}
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

          {/* Arousal / Tension Meter */}
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

          {/* Gear & Inventory */}
          <div
            style={{
              marginTop: 10,
              display: "flex",
              flexDirection: "column",
              gap: 7,
              fontSize: "0.76rem",
            }}
          >
            {/* Equipped Attire & Gear */}
            <div className="cog-step">
              <div className="cog-step-label">
                Equipped &amp; Worn ({equippedList.length})
              </div>
              {equippedList.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
                  {equippedList.map((item, idx) => (
                    <span
                      key={idx}
                      className="badge item-badge item-badge-equipped"
                    >
                      <span>{item}</span>
                      {onToggleItemEquip && (
                        <button
                          type="button"
                          className="item-action-btn"
                          title="Unequip (move to carried inventory)"
                          aria-label={`Unequip ${item}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleItemEquip({
                              character_id: character.id,
                              item,
                              action: "unequip",
                            });
                          }}
                        >
                          <CircleMinus size={12} />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              ) : (
                <div style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "0.72rem" }}>
                  None equipped
                </div>
              )}
            </div>

            {/* Carried Inventory */}
            <div className="cog-step">
              <div className="cog-step-label">
                Carried Inventory ({inventoryList.length})
              </div>
              {inventoryList.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
                  {inventoryList.map((item, idx) => (
                    <span
                      key={idx}
                      className="badge item-badge item-badge-inventory"
                    >
                      <span>{item}</span>
                      {onToggleItemEquip && (
                        <button
                          type="button"
                          className="item-action-btn"
                          title="Equip (move to equipped gear)"
                          aria-label={`Equip ${item}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleItemEquip({
                              character_id: character.id,
                              item,
                              action: "equip",
                            });
                          }}
                        >
                          <CirclePlus size={12} />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              ) : (
                <div style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "0.72rem" }}>
                  Empty inventory
                </div>
              )}
            </div>

            {/* "More" Button to open Character Sheet / Dossier Modal */}
            {onOpenSheet && (
              <button
                type="button"
                className="btn"
                style={{
                  width: "100%",
                  marginTop: 4,
                  padding: "6px 10px",
                  fontSize: "0.75rem",
                  justifyContent: "center",
                  gap: 6,
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-subtle)",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenSheet(character.id);
                }}
              >
                <SlidersHorizontal size={13} color="var(--accent-amber)" />
                <span>More · Character Sheet</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
