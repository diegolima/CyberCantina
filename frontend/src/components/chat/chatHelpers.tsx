import React from "react";
import { Eye, MessageSquare, Radio } from "lucide-react";
import type {
  CampaignStateBundle,
  CampaignStreamError,
  CampaignTurnSendOptions,
  CampaignTurnSendOutcome,
  CharacterRecord,
  CharacterWhisper,
  LiveStreamState,
  MechanicsTopicId,
  Phase3TurnProgress,
  Phase4TurnProgress,
  TurnBookmarkUpdatePayload,
  TurnNodeRecord,
  WorldRecord,
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
  world?: WorldRecord | null;
  character: CharacterRecord;
  pendingLocationOverrideId?: string | null;
  isStreaming: boolean;
  isPhase4Running?: boolean;
  phase3Progress?: Phase3TurnProgress | null;
  phase4ProgressByTurn?: Record<string, Phase4TurnProgress>;
  liveStream: LiveStreamState | null;
  streamError?: CampaignStreamError | string | null;
  onDismissStreamError?: () => void;
  onStopTurn?: () => void;
  onOpenSettings?: () => void;
  onSendTurn: (
    opts: CampaignTurnSendOptions
  ) => Promise<CampaignTurnSendOutcome> | void;
  onCheckoutTurn: (turnId: string) => Promise<void> | void;
  onDeleteLastTurn?: () => Promise<void> | void;
  scrollTargetTurn?: { turnId: string; nonce: number; highlight?: boolean } | null;
  focusComposerNonce?: number;
  onOpenStoryTimelines?: () => void;
  showSidebarToggle?: boolean;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  isInspectorOpen?: boolean;
  onToggleInspector?: () => void;
  hasInspectorAttention?: boolean;
  isMobileLayout?: boolean;
  onUpdateTurnBookmark?: (
    turnId: string,
    payload: TurnBookmarkUpdatePayload
  ) => Promise<TurnNodeRecord | null | void>;
  onSummarizeTurnForBookmark?: (
    turnId: string,
    signal?: AbortSignal
  ) => Promise<string>;
  onCampaignBundleChange?: (bundle: CampaignStateBundle) => void;
  onOpenCodex?: () => void;
  onOpenMechanicsHelp?: (topicId: MechanicsTopicId) => void;
}

export function normalizeCampaignStreamError(
  err: CampaignStreamError | string | null | undefined
): CampaignStreamError | null {
  if (!err) return null;
  if (typeof err === "string") {
    return {
      kind: "turn_pre_save",
      message: err,
      retryable: false,
      failedTurnOpts: null,
    };
  }
  return err;
}

/**
 * True when the turn feed is scrolled noticeably above the bottom edge so a
 * floating "Jump to latest" pill should be surfaced.
 */
export function isTurnFeedScrolledAwayFromBottom(
  metrics: { scrollHeight: number; scrollTop: number; clientHeight: number },
  thresholdPx = 140
): boolean {
  const distanceFromBottom =
    metrics.scrollHeight - (metrics.scrollTop + metrics.clientHeight);
  return distanceFromBottom > thresholdPx;
}

/**
 * Decide whether an `Enter` keydown inside a composer textarea should submit
 * immediately or insert a newline. On touch/coarse-pointer devices lacking
 * Shift+Enter, `Enter` inserts a newline and sending uses the Send / Ask GM button.
 */
export function shouldEnterSubmitComposer(
  e: { key: string; shiftKey: boolean; ctrlKey?: boolean; metaKey?: boolean },
  isCoarsePointer: boolean
): boolean {
  if (e.key !== "Enter") return false;
  if (isCoarsePointer) return Boolean(e.ctrlKey || e.metaKey);
  return !e.shiftKey;
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
