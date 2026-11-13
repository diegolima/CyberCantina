import React from "react";
import { Eye, MessageSquare, Radio } from "lucide-react";
import type {
  CampaignStateBundle,
  CharacterChoiceSet,
  CharacterRecord,
  CharacterWhisper,
  DiceMode,
  LiveStreamState,
  NarrativeMode,
  Phase3TurnProgress,
  Phase4TurnProgress,
} from "../../types";
import { decomposeClientUserMessage } from "../../utils/mentions";

export type { LiveStreamState };

export function getTierBadgeClass(tier?: string): string {
  switch (tier) {
    case "Critical Success":
      return "badge-dice-crit-success";
    case "Clean Success":
      return "badge-dice-clean-success";
    case "Simple Failure":
    case "Partial Success":
      return "badge-dice-simple-failure";
    case "Failure with Consequences":
    case "Failure with Consequence":
      return "badge-dice-consequence-failure";
    case "Critical Failure":
      return "badge-dice-crit-failure";
    default:
      return "";
  }
}

export interface ChatStageProps {
  bundle: CampaignStateBundle;
  character: CharacterRecord;
  pendingLocationOverrideId?: string | null;
  isStreaming: boolean;
  isPhase4Running?: boolean;
  phase3Progress?: Phase3TurnProgress | null;
  phase4ProgressByTurn?: Record<string, Phase4TurnProgress>;
  liveStream: LiveStreamState | null;
  streamError?: string | null;
  onOpenSettings?: () => void;
  onSendTurn: (opts: {
    userMessage: string;
    parentTurnId?: string | null;
    diceMode?: DiceMode;
    manualDiceOverride?: number | null;
    narrativeMode?: NarrativeMode;
    narratorDirective?: string | null;
    durationMinutes?: number | null;
    characterChoices?: Record<string, CharacterChoiceSet>;
  }) => void;
  onCheckoutTurn: (turnId: string) => void;
  onDeleteLastTurn?: () => Promise<void> | void;
  onCloseCampaign?: () => void;
}

export function renderFormattedProse(text: string): React.ReactNode {
  const parts = text.split(/(\*[^*]+\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={idx}>{part.slice(1, -1)}</em>;
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export function renderUserMessageBubble(
  message: string,
  allCampaignCharacters: CharacterRecord[],
  presentCharacterIds: string[],
  turnWhispers?: CharacterWhisper[]
): React.ReactNode {
    const decomposed = decomposeClientUserMessage(
      message,
      allCampaignCharacters,
      presentCharacterIds
    );
    const whispers =
      turnWhispers && turnWhispers.length > 0
        ? turnWhispers
        : decomposed.whispers;
    const publicText = decomposed.public_text.trim();

    if (!whispers || whispers.length === 0) {
      return <div className="user-bubble">{message}</div>;
    }

    return (
      <div className="user-message-container">
        {publicText && (
          <div className="user-bubble user-bubble-shared">{publicText}</div>
        )}
        <div className="whispers-list">
          {whispers.map((w, wIdx) => {
            const isPresent = w.target_scope === "local";
            return (
              <div key={w.character_id || wIdx} className="user-whisper-card">
                <div className="whisper-card-header">
                  <div className="whisper-target-info">
                    <span className="whisper-target-chip">
                      @{w.character_name}
                    </span>
                    {isPresent ? (
                      <span className="mention-badge-present">
                        <span className="presence-dot emerald" />
                        In Location
                      </span>
                    ) : (
                      <span className="mention-badge-remote">
                        <Radio size={10} />
                        Comms
                      </span>
                    )}
                  </div>
                </div>
                <div className="whisper-card-body">
                  {w.speech_parts.map((speech, sIdx) => (
                    <div key={`sp-${sIdx}`} className="whisper-speech-line">
                      <MessageSquare
                        size={12}
                        className="whisper-icon-speech"
                      />
                      <span className="whisper-speech-text">
                        "{speech}"
                      </span>
                    </div>
                  ))}
                  {w.sensory_parts.map((sens, senIdx) => (
                    <div key={`sens-${senIdx}`} className="whisper-sensory-line">
                      <Eye size={12} className="whisper-icon-sensory" />
                      <span className="whisper-sensory-text">{sens}</span>
                    </div>
                  ))}
                  {w.speech_parts.length === 0 &&
                    w.sensory_parts.length === 0 && (
                      <div className="whisper-fallback-line">
                        {w.raw_lines.join("\n")}
                      </div>
                    )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };
