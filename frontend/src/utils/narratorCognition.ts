import type { CognitionBlock, PreTurnAnalysis, TurnNodeRecord } from "../types";

export interface LiveStreamNarratorCheck {
  isNarrator?: boolean;
  isSolo?: boolean;
  cognitionParsed?: CognitionBlock | null;
  preTurn?: PreTurnAnalysis | null;
}

/**
 * Returns true if the turn was produced by the Narrator Meta-Actor.
 */
export function isNarratorTurnNode(
  turn: Pick<TurnNodeRecord, "actor_id" | "user_message">
): boolean {
  return (
    turn.actor_id === "__narrator__" ||
    turn.user_message.startsWith("[NARRATOR DIRECTIVE]")
  );
}

/**
 * Returns true if the turn took place alone in an empty room (solo sentinel).
 */
export function isSoloTurnNode(
  turn: Pick<TurnNodeRecord, "actor_id">
): boolean {
  return turn.actor_id === "__solo__";
}

/**
 * Returns true if a turn's character cognition was unexpectedly skipped/bypassed by the model.
 * Narrator and solo-room turns intentionally do not run character cognition, so they never trigger a skipped warning.
 */
export function isTurnCognitionSkipped(
  turn: Pick<TurnNodeRecord, "actor_id" | "user_message">,
  cognition: CognitionBlock | null | undefined
): boolean {
  if (isNarratorTurnNode(turn) || isSoloTurnNode(turn)) {
    return false;
  }
  if (!cognition) {
    return true;
  }
  return Boolean(cognition.skipped || !cognition.recall);
}

/**
 * Returns true if the active live stream represents a narrator turn.
 */
export function isLiveStreamNarrator(
  live: LiveStreamNarratorCheck | null | undefined
): boolean {
  if (!live) return false;
  return Boolean(
    live.isNarrator ||
      (!live.isSolo &&
        live.preTurn?.active_speaker_id !== "__solo__" &&
        live.cognitionParsed?.feeling === "Objective / Detached") ||
      live.preTurn?.active_speaker_id === "__narrator__"
  );
}

/**
 * Returns true if the active live stream represents a solo-room player turn.
 */
export function isLiveStreamSolo(
  live: LiveStreamNarratorCheck | null | undefined
): boolean {
  if (!live || live.isNarrator || live.preTurn?.active_speaker_id === "__narrator__") {
    return false;
  }
  return Boolean(
    live.isSolo || live.preTurn?.active_speaker_id === "__solo__"
  );
}

/**
 * Returns true if live character cognition was unexpectedly bypassed.
 * When streaming a narrator or solo pass, character cognition is not applicable, so no warning is triggered.
 */
export function isLiveStreamCognitionSkipped(
  live: LiveStreamNarratorCheck | null | undefined,
  activeCog: CognitionBlock | null | undefined
): boolean {
  if (isLiveStreamNarrator(live) || isLiveStreamSolo(live)) {
    return false;
  }
  return Boolean(activeCog?.skipped);
}
