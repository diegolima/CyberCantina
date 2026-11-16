import type { TurnNodeRecord } from "../../types";

/** Stable UI key identifying an individual first-visit description card within a branch turn. */
export function makeArrivalCardKey(turnId: string, entityType: "container" | "location", entityId: string): string {
  return `${turnId}:${entityType}:${entityId}`;
}

/**
 * Determine whether an arrival description card is currently expanded.
 * Only cards belonging to the latest turn default to expanded; when a new turn occurs,
 * all prior cards automatically collapse unless manually reopened after that turn.
 */
export function isArrivalCardExpanded(params: {
  turnId: string;
  lastTurnId: string | undefined;
  cardKey: string;
  manualOverrides: Record<string, boolean>;
}): boolean {
  const { turnId, lastTurnId, cardKey, manualOverrides } = params;
  if (Object.prototype.hasOwnProperty.call(manualOverrides, cardKey)) {
    return manualOverrides[cardKey];
  }
  return Boolean(lastTurnId && turnId === lastTurnId);
}

/** Return the active branch's leaf turn ID for auto-collapse tracking. */
export function getLatestBranchTurnId(turns: TurnNodeRecord[]): string | undefined {
  return turns.length > 0 ? turns[turns.length - 1].id : undefined;
}
