import React from "react";
import { BookOpen, MapPin, User, Users } from "lucide-react";
import {
  CharacterRecord,
  CharacterStateSnapshot,
  getPhysicalStanceMeta,
} from "../../types";
import { getCharacterEmotionPortrait } from "../../utils/entityImages";
import { ChangeDot, MiniMoodBars } from "./InspectorPrimitives";

interface CharacterRowProps {
  character: CharacterRecord;
  state: CharacterStateSnapshot;
  /** False when the character is elsewhere in the world. */
  isPresent: boolean;
  /** Name of the character's current location when not present. */
  elsewhereLocationName?: string;
  /** Whether the mood shifted on the latest turn. */
  moodChanged?: boolean;
  /** Party role badge for this character on the active turn. */
  partyRole?: "player_party" | "npc_leader" | "npc_party" | null;
  partyName?: string | null;
  /** Whether to prefix line 2 with the `Present` indicator when co-present. */
  showPresenceLabel?: boolean;
  /** Open this character directly in the Codex on the Current tab. */
  onOpenInCodex?: (characterId: string) => void;
}

/** Compact clickable character card in the right pane that opens the unified Codex dossier. */
export const CharacterRow: React.FC<CharacterRowProps> = ({
  character,
  state,
  isPresent,
  elsewhereLocationName,
  moodChanged,
  partyRole = null,
  partyName = null,
  showPresenceLabel = true,
  onOpenInCodex,
}) => {
  const care = state.care_state ?? null;
  const composureValue = care ? care.composure : 0.82;
  const composurePct = Math.round(composureValue * 100);
  const activeEmotion = care?.active_emotion ?? "default";
  const portraitUrl = getCharacterEmotionPortrait(character, activeEmotion);
  const stanceValue = state.physical_stance ?? "unspecified";
  const showStancePill = isPresent && stanceValue !== "unspecified";
  const stanceMeta = showStancePill ? getPhysicalStanceMeta(stanceValue) : null;
  const stanceTitle = state.physical_context?.trim()
    ? `${stanceMeta?.label}: ${state.physical_context.trim()}`
    : stanceMeta?.shortHint || stanceMeta?.label;

  return (
    <div className={`char-row ${isPresent ? "" : "char-row-absent"}`}>
      <button
        type="button"
        className="char-row-header char-row-card"
        onClick={() => onOpenInCodex?.(character.id)}
        aria-label={`Open ${character.name} in Codex`}
        title={`Open ${character.name} in Codex`}
      >
        <span className="char-row-identity">
          {portraitUrl ? (
            <img
              src={portraitUrl}
              alt={`${character.name} (${activeEmotion})`}
              title={`Expression: ${activeEmotion}`}
              className="char-row-portrait"
            />
          ) : (
            <span className="char-row-portrait char-row-portrait--fallback">
              <User size={15} color="var(--accent-cyan)" />
            </span>
          )}
          <span className="char-row-text">
            <span className="char-row-name-line">
              <span className="char-row-name">{character.name}</span>
              {partyRole === "player_party" && (
                <span
                  className="party-pill party-pill--player"
                  title={partyName || "In your party"}
                >
                  <Users size={10} />
                  <span>In Party</span>
                </span>
              )}
              {(partyRole === "npc_party" || partyRole === "npc_leader") && (
                <span
                  className="party-pill party-pill--npc"
                  title={partyName || "NPC Party"}
                >
                  <Users size={10} />
                  <span>
                    {partyRole === "npc_leader"
                      ? "NPC Party · Leader"
                      : "NPC Party"}
                  </span>
                </span>
              )}
              {activeEmotion !== "default" && (
                <span
                  className="badge"
                  style={{
                    fontSize: "0.62rem",
                    padding: "0px 5px",
                    textTransform: "capitalize",
                    opacity: 0.9,
                  }}
                >
                  {activeEmotion}
                </span>
              )}
              {showStancePill && stanceMeta && (
                <span
                  className={`physical-stance-pill physical-stance-pill--${stanceMeta.tone} char-row-stance-pill`}
                  title={stanceTitle}
                >
                  {stanceMeta.label}
                </span>
              )}
              {moodChanged && <ChangeDot title="Mood shifted this turn" />}
            </span>
            <span className="char-row-status-line">
              {isPresent ? (
                showPresenceLabel && (
                  <>
                    <span className="char-row-present">
                      <MapPin size={10} />
                      Present
                    </span>
                    <span aria-hidden="true">·</span>
                  </>
                )
              ) : (
                <>
                  <span className="char-row-elsewhere">
                    <MapPin size={10} />
                    Elsewhere{elsewhereLocationName ? ` · ${elsewhereLocationName}` : ""}
                  </span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span
                className="char-row-mood"
                title={care?.outward_demeanor || state.mood_label}
              >
                {state.mood_label}
              </span>
            </span>
            <span className="char-row-composure" title={`Composure Mask: ${composurePct}%`}>
              <span className="char-row-composure-label">
                Composure {composurePct}%
              </span>
              <span className="char-row-composure-track">
                <span
                  className="char-row-composure-fill"
                  style={{
                    width: `${composurePct}%`,
                    background:
                      composureValue >= 0.45 ? "#a78bfa" : "var(--accent-rose)",
                  }}
                />
              </span>
            </span>
          </span>
        </span>
        <span className="char-row-right">
          <MiniMoodBars valence={state.valence} arousal={state.arousal} />
          <BookOpen size={13} className="char-row-open-icon" aria-hidden="true" />
        </span>
      </button>
    </div>
  );
};
