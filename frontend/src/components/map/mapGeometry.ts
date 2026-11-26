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
export const LOCATION_HOVER_RADIUS = 38;
export const CONTAINER_HOVER_PAD = 12;
export const CONTAINER_PORT_OFFSET = 7;
export const CONTAINER_HIT_HALF_W = CONTAINER_CARD_HALF_W + 2;
export const CONTAINER_HIT_HALF_H = CONTAINER_CARD_HALF_H + 3;
export const PORT_HIT_RADIUS = 8;
export const PORT_TOUCH_HIT_RADIUS = 14;

export const DEFAULT_MAP_VIEWBOX_W = 680;
export const DEFAULT_MAP_VIEWBOX_H = 520;
export const TAP_MOVE_THRESHOLD_PX = 5;
export const DOUBLE_TAP_MAX_MS = 300;
export const DOUBLE_TAP_MAX_DIST_PX = 28;

export interface MapViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute an aspect-matched SVG viewBox centered at (0, 0).
 * - Falls back to the canonical 680x520 landscape box when dimensions are unavailable (SSR/tests).
 * - On narrow/portrait containers (< 680px wide), uses container CSS dimensions directly so
 *   nodes, labels, and touch targets stay near 1:1 CSS pixels instead of shrinking to ~0.57x.
 * - On desktop containers (>= 680px wide), preserves balanced framing anchored to 680x520.
 */
export function computeResponsiveViewBox(
  containerW: number,
  containerH: number
): MapViewBox {
  if (
    !Number.isFinite(containerW) ||
    !Number.isFinite(containerH) ||
    containerW <= 0 ||
    containerH <= 0
  ) {
    return {
      x: -DEFAULT_MAP_VIEWBOX_W / 2,
      y: -DEFAULT_MAP_VIEWBOX_H / 2,
      width: DEFAULT_MAP_VIEWBOX_W,
      height: DEFAULT_MAP_VIEWBOX_H,
    };
  }
  if (containerW < DEFAULT_MAP_VIEWBOX_W) {
    const width = Math.max(240, Math.round(containerW));
    const height = Math.max(240, Math.round(containerH));
    return {
      x: -width / 2,
      y: -height / 2,
      width,
      height,
    };
  }
  const baseScale = Math.min(
    containerW / DEFAULT_MAP_VIEWBOX_W,
    containerH / DEFAULT_MAP_VIEWBOX_H
  );
  const width = Math.max(DEFAULT_MAP_VIEWBOX_W, Math.round(containerW / baseScale));
  const height = Math.max(DEFAULT_MAP_VIEWBOX_H, Math.round(containerH / baseScale));
  return {
    x: -width / 2,
    y: -height / 2,
    width,
    height,
  };
}

/** Compute CSS-pixels-per-SVG-viewBox-unit scale factor for an SVG element rect. */
export function computeSvgClientScale(
  rect: { width: number; height: number } | null | undefined,
  viewBox: { width: number; height: number } = {
    width: DEFAULT_MAP_VIEWBOX_W,
    height: DEFAULT_MAP_VIEWBOX_H,
  }
): number {
  if (
    !rect ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    viewBox.width <= 0 ||
    viewBox.height <= 0
  ) {
    return 1;
  }
  return Math.min(rect.width / viewBox.width, rect.height / viewBox.height) || 1;
}

/** Convert client-space drag deltas into SVG world-space pan deltas for 1:1 finger tracking. */
export function computePanDeltaWorld(
  rawDx: number,
  rawDy: number,
  svgScale: number,
  zoom: number
): { dx: number; dy: number } {
  const denom = Math.max(0.05, (svgScale || 1) * (zoom || 1));
  return {
    dx: rawDx / denom,
    dy: rawDy / denom,
  };
}

/**
 * Compute updated zoom and pan for a two-finger pinch gesture so `anchorWorld`
 * remains pinned directly beneath the current client midpoint `midClient`.
 */
export function computePinchZoomPan(params: {
  initialZoom: number;
  initialDist: number;
  currentDist: number;
  anchorWorld: { x: number; y: number };
  midClient: { x: number; y: number };
  svgRect: { left: number; top: number; width: number; height: number };
  viewBox: { width: number; height: number };
}): { zoom: number; pan: { x: number; y: number } } {
  const {
    initialZoom,
    initialDist,
    currentDist,
    anchorWorld,
    midClient,
    svgRect,
    viewBox,
  } = params;
  const ratio = initialDist > 1 ? currentDist / initialDist : 1;
  const nextZoom = clampZoom(initialZoom * ratio);
  const svgScale = computeSvgClientScale(svgRect, viewBox);
  const vbX = (midClient.x - (svgRect.left + svgRect.width / 2)) / svgScale;
  const vbY = (midClient.y - (svgRect.top + svgRect.height / 2)) / svgScale;
  return {
    zoom: nextZoom,
    pan: {
      x: vbX / nextZoom - anchorWorld.x,
      y: vbY / nextZoom - anchorWorld.y,
    },
  };
}

/**
 * Compute focal zoom toggle for a double-tap on empty canvas:
 * zooms in (+0.75) when zoom < 1.5, or resets to 1.0 when zoom >= 1.5,
 * keeping `tappedWorld` anchored under `tapClient`.
 */
export function computeDoubleTapZoomPan(params: {
  currentZoom: number;
  tappedWorld: { x: number; y: number };
  tapClient: { x: number; y: number };
  svgRect: { left: number; top: number; width: number; height: number };
  viewBox: { width: number; height: number };
}): { zoom: number; pan: { x: number; y: number } } {
  const { currentZoom, tappedWorld, tapClient, svgRect, viewBox } = params;
  const nextZoom = currentZoom < 1.5 ? clampZoom(currentZoom + 0.75) : 1;
  const svgScale = computeSvgClientScale(svgRect, viewBox);
  const vbX = (tapClient.x - (svgRect.left + svgRect.width / 2)) / svgScale;
  const vbY = (tapClient.y - (svgRect.top + svgRect.height / 2)) / svgScale;
  return {
    zoom: nextZoom,
    pan: {
      x: vbX / nextZoom - tappedWorld.x,
      y: vbY / nextZoom - tappedWorld.y,
    },
  };
}

/**
 * Determine whether touching a node/container/ghost should defer dragging to
 * tap-to-select-first (allowing swipes to pan the map instead of moving the node).
 */
export function shouldDeferNodeDragToTapFirst(params: {
  pointerType: string;
  isSelected: boolean;
  isMutatingLocked: boolean;
}): boolean {
  if (params.isMutatingLocked) return true;
  if (params.pointerType === "touch" && !params.isSelected) return true;
  return false;
}

/** Compute world-space coordinates for a container supernode perimeter port dot. */
export function getContainerPortPoint(
  center: { x: number; y: number },
  angleRadians: number
): { x: number; y: number } {
  return {
    x: center.x + Math.cos(angleRadians) * (CONTAINER_CARD_HALF_W + CONTAINER_PORT_OFFSET),
    y: center.y + Math.sin(angleRadians) * (CONTAINER_CARD_HALF_H + CONTAINER_PORT_OFFSET),
  };
}

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
export function isEditableKeyboardTarget(
  target: unknown,
  hostContainer?: unknown
): boolean {
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
    if (
      el.closest(
        "input, textarea, select, [contenteditable='true'], .tag-chips-container"
      )
    ) {
      return true;
    }
    const modal = el.closest("[aria-modal='true']") as {
      contains?: (other: unknown) => boolean;
    } | null;
    if (modal) {
      // Allow shortcuts when the closest aria-modal ancestor is an outer sheet
      // enclosing the interactive host itself (e.g. WorldInspectorModal wrapping
      // SpatialTopologyView or WorldCodexTab), while still blocking inside
      // nested or stacked modal dialogs.
      if (
        hostContainer &&
        modal !== hostContainer &&
        typeof modal.contains === "function" &&
        modal.contains(hostContainer)
      ) {
        return false;
      }
      return true;
    }
  }
  return false;
}
