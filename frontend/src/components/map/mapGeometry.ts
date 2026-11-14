export const LOCATION_TILE_SIZE = 36;
export const LOCATION_TILE_HALF = LOCATION_TILE_SIZE / 2;
export const LOCATION_TILE_RX = 10;
export const HUB_RADIUS = 17;
export const CONTAINER_CARD_W = 148;
export const CONTAINER_CARD_H = 50;
export const CONTAINER_CARD_HALF_W = CONTAINER_CARD_W / 2;
export const CONTAINER_CARD_HALF_H = CONTAINER_CARD_H / 2;
export const CONTAINER_CARD_RX = 8;

export const GHOST_CARD_W = 132;
export const GHOST_CARD_H = 42;
export const GHOST_CARD_HALF_W = GHOST_CARD_W / 2;
export const GHOST_CARD_HALF_H = GHOST_CARD_H / 2;
export const GHOST_CARD_RX = 8;

export const LOCATION_PORT_RADIUS = 26;
export const LOCATION_HOVER_RADIUS = 34;
export const CONTAINER_HOVER_PAD = 12;
export const PORT_HIT_RADIUS = 8;

export const MIN_MAP_ZOOM = 0.35;
export const MAX_MAP_ZOOM = 3;

export type NodeShapeDescriptor =
  | { kind: "location" }
  | { kind: "hub" }
  | { kind: "container" }
  | { kind: "ghost" };

export interface ClippedEdgeGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  midX: number;
  midY: number;
  collapsed: boolean;
}

/** Clamp zoom within supported bounds rounded to 2 decimal places. */
export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_MAP_ZOOM, Math.max(MIN_MAP_ZOOM, +value.toFixed(2)));
}

/** Resolve the SVG canvas cursor based on active interaction precedence. */
export function resolveCanvasCursor(params: {
  isNodeDragging: boolean;
  isLinking: boolean;
  isPanning: boolean;
}): "grabbing" | "crosshair" | "grab" {
  if (params.isNodeDragging) return "grabbing";
  if (params.isLinking) return "crosshair";
  if (params.isPanning) return "grabbing";
  return "grab";
}

function rayRoundedRectExitDistance(
  ux: number,
  uy: number,
  halfW: number,
  halfH: number,
  rx: number
): number {
  const ax = Math.abs(ux);
  const ay = Math.abs(uy);
  const tx = ax > 1e-9 ? halfW / ax : Infinity;
  const ty = ay > 1e-9 ? halfH / ay : Infinity;
  const tBox = Math.min(tx, ty);
  if (!Number.isFinite(tBox)) return 0;

  const px = tBox * ax;
  const py = tBox * ay;
  const cx = halfW - rx;
  const cy = halfH - rx;

  if (px > cx && py > cy && rx > 0) {
    // Ray intersects the rounded corner circle centered at (cx, cy) with radius rx
    const b = ax * cx + ay * cy;
    const c = cx * cx + cy * cy - rx * rx;
    const disc = b * b - c;
    if (disc >= 0) {
      return b + Math.sqrt(disc);
    }
  }
  return tBox;
}

function rayOctagonExitDistance(ux: number, uy: number, radius: number): number {
  // Matches hubPoints vertices at k * (pi/4) + (pi/8), so flat face normals are m * (pi/4)
  const apothem = radius * Math.cos(Math.PI / 8);
  let minT = Infinity;
  for (let m = 0; m < 8; m++) {
    const angle = (m * Math.PI) / 4;
    const proj = ux * Math.cos(angle) + uy * Math.sin(angle);
    if (proj > 1e-9) {
      const t = apothem / proj;
      if (t < minT) minT = t;
    }
  }
  return Number.isFinite(minT) ? minT : radius;
}

/** Compute ray exit distance from shape center along direction (dx, dy). */
export function computeRayShapeExitDistance(
  dx: number,
  dy: number,
  shape: NodeShapeDescriptor
): number {
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return 0;
  const ux = dx / len;
  const uy = dy / len;

  if (shape.kind === "container") {
    return rayRoundedRectExitDistance(
      ux,
      uy,
      CONTAINER_CARD_HALF_W,
      CONTAINER_CARD_HALF_H,
      CONTAINER_CARD_RX
    );
  }
  if (shape.kind === "ghost") {
    return rayRoundedRectExitDistance(
      ux,
      uy,
      GHOST_CARD_HALF_W,
      GHOST_CARD_HALF_H,
      GHOST_CARD_RX
    );
  }
  if (shape.kind === "hub") {
    return rayOctagonExitDistance(ux, uy, HUB_RADIUS);
  }
  return rayRoundedRectExitDistance(
    ux,
    uy,
    LOCATION_TILE_HALF,
    LOCATION_TILE_HALF,
    LOCATION_TILE_RX
  );
}

/** Clip a center-to-center link segment to endpoint perimeters and compute visible midpoint. */
export function computeEdgeClippedSegment(
  p1: { x: number; y: number },
  shape1: NodeShapeDescriptor,
  p2: { x: number; y: number },
  shape2: NodeShapeDescriptor
): ClippedEdgeGeometry {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const dist = Math.hypot(dx, dy);

  if (dist < 1e-3) {
    return {
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      midX: p1.x,
      midY: p1.y,
      collapsed: true,
    };
  }

  const ux = dx / dist;
  const uy = dy / dist;
  const t1 = computeRayShapeExitDistance(dx, dy, shape1);
  const t2 = computeRayShapeExitDistance(-dx, -dy, shape2);

  if (t1 + t2 >= dist) {
    return {
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      midX: (p1.x + p2.x) / 2,
      midY: (p1.y + p2.y) / 2,
      collapsed: true,
    };
  }

  const x1 = p1.x + ux * t1;
  const y1 = p1.y + uy * t1;
  const x2 = p2.x - ux * t2;
  const y2 = p2.y - uy * t2;
  return {
    x1,
    y1,
    x2,
    y2,
    midX: (x1 + x2) / 2,
    midY: (y1 + y2) / 2,
    collapsed: false,
  };
}

/** Compute badge width dynamically so longer aggregated/locked labels stay enclosed. */
export function computeDistanceBadgeWidth(labelText: string): number {
  return Math.max(44, Math.ceil(labelText.length * 5.6 + 14));
}

/**
 * Determine whether a keyboard event originates from (or while focused in) an
 * editable control so global canvas shortcuts like `Delete` never intercept typing.
 */
export function isEditableKeyboardTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as {
    tagName?: string;
    isContentEditable?: boolean;
    closest?: (selector: string) => unknown;
  };
  const tag = (el.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (el.isContentEditable) {
    return true;
  }
  if (typeof el.closest === "function") {
    return Boolean(
      el.closest("input, textarea, select, [contenteditable='true'], .tag-chips-container")
    );
  }
  return false;
}
