import type { CompassDirection, LocationContainer, LocationNode } from "../../types";
import { DOUBLE_TAP_MAX_DIST_PX, DOUBLE_TAP_MAX_MS } from "../map/mapGeometry";

export const MINI_MAP_WIDTH = 330;
export const MINI_MAP_HEIGHT = 236;
export const MINI_MAP_CENTER = { x: 165, y: 118 } as const;
export const MINI_MAP_RX = 102;
export const MINI_MAP_RY = 72;

export const ENVELOPE_HUB_RADIUS = 22;
export const ENVELOPE_ARM_RADIUS = 14;
export const ENVELOPE_TIP_RADIUS = 20;
export const ENVELOPE_BORDER_WIDTH = 1.5;

export const MINI_MAP_DRAG_CANCEL_PX = 10;
export const MINI_MAP_SYNTHETIC_DBLCLICK_SUPPRESS_MS = 450;

export type MiniMapOpenIntent =
  | { kind: "empty" }
  | { kind: "active" }
  | { kind: "location"; id: string }
  | { kind: "container"; id: string };

export interface MiniMapTouchTapCandidate {
  pointerId: number;
  targetKey: string;
  startX: number;
  startY: number;
  cancelled: boolean;
}

export interface MiniMapLastTapRecord {
  targetKey: string;
  time: number;
  clientX: number;
  clientY: number;
}

export interface MiniMapTouchGestureState {
  activeCandidate: MiniMapTouchTapCandidate | null;
  lastTap: MiniMapLastTapRecord | null;
  suppressDblClickUntil: number;
}

export function createMiniMapTouchGestureState(): MiniMapTouchGestureState {
  return {
    activeCandidate: null,
    lastTap: null,
    suppressDblClickUntil: 0,
  };
}

export function beginMiniMapTouchTap(
  state: MiniMapTouchGestureState,
  tap: { pointerId: number; targetKey: string; clientX: number; clientY: number }
): MiniMapTouchGestureState {
  return {
    ...state,
    activeCandidate: {
      pointerId: tap.pointerId,
      targetKey: tap.targetKey,
      startX: tap.clientX,
      startY: tap.clientY,
      cancelled: false,
    },
  };
}

export function moveMiniMapTouchTap(
  state: MiniMapTouchGestureState,
  move: { pointerId: number; clientX: number; clientY: number }
): MiniMapTouchGestureState {
  const candidate = state.activeCandidate;
  if (!candidate || candidate.pointerId !== move.pointerId || candidate.cancelled) {
    return state;
  }
  const movedDist = Math.hypot(
    move.clientX - candidate.startX,
    move.clientY - candidate.startY
  );
  if (movedDist > MINI_MAP_DRAG_CANCEL_PX) {
    return {
      ...state,
      activeCandidate: { ...candidate, cancelled: true },
      lastTap: null,
    };
  }
  return state;
}

export function cancelMiniMapTouchTap(
  state: MiniMapTouchGestureState,
  pointerId?: number
): MiniMapTouchGestureState {
  if (
    pointerId !== undefined &&
    state.activeCandidate &&
    state.activeCandidate.pointerId !== pointerId
  ) {
    return state;
  }
  return {
    ...state,
    activeCandidate: null,
    lastTap: null,
  };
}

export function completeMiniMapTouchTap(
  state: MiniMapTouchGestureState,
  tap: {
    pointerId: number;
    targetKey: string;
    clientX: number;
    clientY: number;
    now: number;
  }
): { state: MiniMapTouchGestureState; triggered: boolean } {
  const candidate = state.activeCandidate;
  if (
    !candidate ||
    candidate.pointerId !== tap.pointerId ||
    candidate.cancelled ||
    candidate.targetKey !== tap.targetKey
  ) {
    return {
      state: {
        ...state,
        activeCandidate: null,
      },
      triggered: false,
    };
  }

  const prevTap = state.lastTap;
  const isDoubleTap =
    prevTap !== null &&
    prevTap.targetKey === tap.targetKey &&
    tap.now - prevTap.time <= DOUBLE_TAP_MAX_MS &&
    Math.hypot(tap.clientX - prevTap.clientX, tap.clientY - prevTap.clientY) <=
      DOUBLE_TAP_MAX_DIST_PX;

  if (isDoubleTap) {
    return {
      state: {
        activeCandidate: null,
        lastTap: null,
        suppressDblClickUntil:
          tap.now + MINI_MAP_SYNTHETIC_DBLCLICK_SUPPRESS_MS,
      },
      triggered: true,
    };
  }

  return {
    state: {
      ...state,
      activeCandidate: null,
      lastTap: {
        targetKey: tap.targetKey,
        time: tap.now,
        clientX: tap.clientX,
        clientY: tap.clientY,
      },
    },
    triggered: false,
  };
}

export function shouldSuppressSyntheticDblClick(
  state: MiniMapTouchGestureState,
  now: number
): boolean {
  return now <= state.suppressDblClickUntil;
}

export function resolveFullMapModalProps(
  intent: MiniMapOpenIntent | null,
  activeLocationId: string,
  focusNonce: number
): {
  defaultSelectedLocationId: string | null;
  externalFocusRequest: {
    kind: "location" | "container";
    id: string;
    nonce: number;
  } | null;
} {
  if (!intent || intent.kind === "active") {
    return {
      defaultSelectedLocationId: activeLocationId,
      externalFocusRequest: null,
    };
  }
  if (intent.kind === "empty") {
    return {
      defaultSelectedLocationId: null,
      externalFocusRequest: null,
    };
  }
  return {
    defaultSelectedLocationId: null,
    externalFocusRequest: {
      kind: intent.kind,
      id: intent.id,
      nonce: focusNonce,
    },
  };
}

export interface Point2D {
  x: number;
  y: number;
}

export interface Segment2D {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BoundaryMarkerTicks {
  gap: Segment2D;
  bar1: Segment2D;
  bar2: Segment2D;
}

/**
 * True when a location sits in the active container or any descendant container
 * nested inside it (walking `parent_container_id` with cycle protection).
 */
export function isSameContainerLocation(
  locContainerId: string | null | undefined,
  activeContainerId: string | null | undefined,
  containerMap?: ReadonlyMap<string, LocationContainer>
): boolean {
  if (!locContainerId || !activeContainerId) return false;
  if (locContainerId === activeContainerId) return true;
  if (!containerMap) return false;

  const seen = new Set<string>();
  let currId: string | null | undefined = locContainerId;
  while (currId && !seen.has(currId)) {
    if (currId === activeContainerId) return true;
    seen.add(currId);
    currId = containerMap.get(currId)?.parent_container_id ?? null;
  }
  return false;
}

/**
 * True when an edge crosses outside the active container's hierarchy
 * (or enters a container from uncontained root space).
 */
export function doesEdgeCrossContainer(
  destContainerId: string | null | undefined,
  activeContainerId: string | null | undefined,
  containerMap?: ReadonlyMap<string, LocationContainer>
): boolean {
  const destCid = destContainerId ?? null;
  const activeCid = activeContainerId ?? null;
  if (!activeCid) return destCid !== null;
  if (containerMap && containerMap.has(activeCid)) {
    return !isSameContainerLocation(destCid, activeCid, containerMap);
  }
  return destCid !== activeCid;
}

/** Resolve external sub-label (`[Container]` or `[Outside]`) for an adjacent location. */
export function resolveExternalContainerLabel(
  loc: Pick<LocationNode, "container_id">,
  activeContainerId: string | null | undefined,
  containerMap: ReadonlyMap<string, LocationContainer>
): string | null {
  const locCid = loc.container_id ?? null;
  const activeCid = activeContainerId ?? null;
  if (locCid === activeCid) return null;
  if (locCid) {
    const cont = containerMap.get(locCid);
    if (!cont) return null;
    const shortName = cont.name.length > 13 ? `${cont.name.slice(0, 12)}…` : cont.name;
    return `[${shortName}]`;
  }
  return activeCid ? "[Outside]" : null;
}

/**
 * Compute an orthogonal, genre-neutral threshold gate along a container-crossing ray.
 * Places the marker inside the unobstructed ray gap away from node boxes and labels.
 */
export function computeBoundaryMarkerTicks(
  p1: Point2D,
  p2: Point2D,
  slot?: CompassDirection
): BoundaryMarkerTicks | null {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-3) return null;

  const ux = dx / dist;
  const uy = dy / dist;
  const px = -uy;
  const py = ux;

  // Lower-hemisphere rays (S, SE, SW) place the gate past the center node's bottom label.
  let d: number;
  if (slot === "N") {
    d = Math.min(dist - 34, Math.max(26, dist * 0.36));
  } else if (slot === "S") {
    d = Math.min(dist - 22, Math.max(48, dist * 0.68));
  } else if (uy > 0.3) {
    d = Math.min(dist - 22, Math.max(48, dist * 0.63));
  } else {
    d = Math.min(dist - 22, Math.max(26, dist * 0.32));
  }

  const cx = p1.x + ux * d;
  const cy = p1.y + uy * d;
  const halfGap = 1.75;
  const halfBar = 5;

  const b1x = cx - ux * halfGap;
  const b1y = cy - uy * halfGap;
  const b2x = cx + ux * halfGap;
  const b2y = cy + uy * halfGap;

  return {
    gap: {
      x1: +b1x.toFixed(2),
      y1: +b1y.toFixed(2),
      x2: +b2x.toFixed(2),
      y2: +b2y.toFixed(2),
    },
    bar1: {
      x1: +(b1x - px * halfBar).toFixed(2),
      y1: +(b1y - py * halfBar).toFixed(2),
      x2: +(b1x + px * halfBar).toFixed(2),
      y2: +(b1y + py * halfBar).toFixed(2),
    },
    bar2: {
      x1: +(b2x - px * halfBar).toFixed(2),
      y1: +(b2y - py * halfBar).toFixed(2),
      x2: +(b2x + px * halfBar).toFixed(2),
      y2: +(b2y + py * halfBar).toFixed(2),
    },
  };
}
