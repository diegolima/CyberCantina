import type { CharacterStateSnapshot, TurnNodeRecord } from "../../../types";

export type RelationalMetricKey =
  | "warmth"
  | "trust"
  | "respect"
  | "power"
  | "grievance"
  | "obligation";

export interface RelationalMetricMeta {
  key: RelationalMetricKey;
  label: string;
  color: string;
  defaultEnabled: boolean;
  dashed?: boolean;
  isPercent?: boolean;
}

export const RELATIONAL_METRICS: readonly RelationalMetricMeta[] = [
  {
    key: "warmth",
    label: "Warmth",
    color: "#10b981",
    defaultEnabled: true,
  },
  {
    key: "trust",
    label: "Trust",
    color: "#06b6d4",
    defaultEnabled: true,
  },
  {
    key: "respect",
    label: "Respect",
    color: "#8b5cf6",
    defaultEnabled: true,
  },
  {
    key: "power",
    label: "Power",
    color: "#f59e0b",
    defaultEnabled: true,
  },
  {
    key: "grievance",
    label: "Grievance",
    color: "#f43f5e",
    defaultEnabled: false,
    dashed: true,
    isPercent: true,
  },
  {
    key: "obligation",
    label: "Obligation",
    color: "#94a3b8",
    defaultEnabled: false,
    dashed: true,
  },
] as const;

export interface RelationalHistoryPoint {
  turnId: string;
  depthIndex: number;
  warmth: number;
  trust: number;
  respect: number;
  power: number;
  grievance: number;
  obligation: number;
  episodicNote: string;
}

function resolveTurnCharacterSnapshot(
  turn: TurnNodeRecord,
  characterId: string
): CharacterStateSnapshot | undefined {
  if (turn.character_states?.[characterId]) {
    return turn.character_states[characterId];
  }
  if (turn.character_state?.character_id === characterId) {
    return turn.character_state;
  }
  return undefined;
}

/**
 * Extract an ordered turn-by-turn relational series for one character -> target bond
 * across the active timeline branch, omitting `__arrival__` map-move waypoints and
 * starting at the first turn the bond existed.
 */
export function extractBondHistorySeries(opts: {
  characterId: string;
  targetId: string;
  activeBranchTurns?: readonly TurnNodeRecord[];
  currentState?: CharacterStateSnapshot | null;
}): RelationalHistoryPoint[] {
  const { characterId, targetId, activeBranchTurns = [], currentState } = opts;
  const points: RelationalHistoryPoint[] = [];
  const seenTurnIds = new Set<string>();

  for (const turn of activeBranchTurns) {
    if (turn.actor_id === "__arrival__") continue;
    const snap = resolveTurnCharacterSnapshot(turn, characterId);
    const edge = snap?.care_state?.relations?.[targetId];
    if (!snap || !edge) continue;

    seenTurnIds.add(turn.id);
    if (snap.turn_id) seenTurnIds.add(snap.turn_id);

    points.push({
      turnId: turn.id,
      depthIndex: turn.depth_index,
      warmth: edge.warmth,
      trust: edge.trust,
      respect: edge.respect,
      power: edge.power,
      grievance: edge.grievance,
      obligation: edge.obligation,
      episodicNote: edge.episodic_note || snap.relationship_notes?.[targetId] || "",
    });
  }

  const liveEdge = currentState?.care_state?.relations?.[targetId];
  if (currentState && liveEdge && !seenTurnIds.has(currentState.turn_id)) {
    points.push({
      turnId: currentState.turn_id,
      depthIndex:
        points.length > 0 ? points[points.length - 1].depthIndex + 1 : 0,
      warmth: liveEdge.warmth,
      trust: liveEdge.trust,
      respect: liveEdge.respect,
      power: liveEdge.power,
      grievance: liveEdge.grievance,
      obligation: liveEdge.obligation,
      episodicNote:
        liveEdge.episodic_note ||
        currentState.relationship_notes?.[targetId] ||
        "",
    });
  }

  return points;
}

export function sliceBondHistoryWindow(
  points: readonly RelationalHistoryPoint[],
  windowMode: "all" | "last25"
): readonly RelationalHistoryPoint[] {
  if (windowMode === "last25" && points.length > 25) {
    return points.slice(points.length - 25);
  }
  return points;
}

export function computeSparseTickIndices(
  count: number,
  maxTicks = 6
): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  if (count <= maxTicks) {
    return Array.from({ length: count }, (_, idx) => idx);
  }
  const indices = new Set<number>([0, count - 1]);
  const steps = maxTicks - 1;
  for (let i = 1; i < steps; i++) {
    indices.add(Math.round((i * (count - 1)) / steps));
  }
  return Array.from(indices).sort((a, b) => a - b);
}

export function mapValueToChartY(
  value: number,
  plotTop: number,
  plotHeight: number
): number {
  const clamped = Math.max(-1, Math.min(1, value));
  return plotTop + ((1 - clamped) / 2) * plotHeight;
}

export function formatMetricValue(
  metric: RelationalMetricMeta,
  value: number
): string {
  if (metric.isPercent) {
    return `${Math.round(value * 100)}%`;
  }
  return value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}
