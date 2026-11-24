import type { CompassDirection, LocationEdge } from "../../types";
import {
  GHOST_CARD_HALF_H,
  GHOST_CARD_HALF_W,
  type MapViewBox,
  clampZoom,
} from "./mapGeometry";
import {
  COMPASS_ANGLES,
  COMPASS_ORDER,
  OPPOSITE_COMPASS,
  type ProjectedDepthTopology,
  computeGhostNodeCoords,
  inferCompassDirection,
} from "./topologyProjection";

export const AUTO_LAYOUT_MIN_SPAN = 150;
export const AUTO_LAYOUT_MAX_SPAN = 460;
export const AUTO_LAYOUT_EDGE_CLEARANCE = 68;
export const AUTO_LAYOUT_BOX_PAD = 24;
export const AUTO_LAYOUT_COMPONENT_GAP = 72;
export const AUTO_LAYOUT_FIT_MAX_ZOOM = 1.15;

export interface NodeFootprint {
  halfW: number;
  halfH: number;
}

export interface ReducedLayoutEdge {
  u: string;
  v: string;
  angleUV: number;
  distanceMeters: number;
  targetLength: number;
  usedSecretFallback: boolean;
}

export interface ScopedAutoLayoutInput {
  projectedTopology: ProjectedDepthTopology;
  footprints: Record<string, NodeFootprint>;
}

export interface ScopedAutoLayoutResult {
  coords: Record<string, { x: number; y: number }>;
  ghostCoords: Record<string, { x: number; y: number }>;
}

const DEFAULT_FOOTPRINT: NodeFootprint = { halfW: 54, halfH: 34 };

function getFootprint(
  id: string,
  footprints: Record<string, NodeFootprint>
): NodeFootprint {
  return footprints[id] ?? DEFAULT_FOOTPRINT;
}

function aabbRayExitDistance(
  fp: NodeFootprint,
  ux: number,
  uy: number
): number {
  const ax = Math.abs(ux);
  const ay = Math.abs(uy);
  const tx = ax > 1e-9 ? fp.halfW / ax : Infinity;
  const ty = ay > 1e-9 ? fp.halfH / ay : Infinity;
  const dist = Math.min(tx, ty);
  return Number.isFinite(dist) ? dist : 0;
}

/**
 * Compute target center-to-center length in SVG units for an edge using a
 * monotonic log-compressed metric distance curve clamped to [150, 460] plus
 * directional footprint clearance so wide supernode cards and badges stay legible.
 */
export function computeAutoLayoutEdgeLength(
  distanceMeters: number,
  fpU: NodeFootprint,
  fpV: NodeFootprint,
  angleUV: number
): number {
  const safeMeters = Number.isFinite(distanceMeters)
    ? Math.max(1, distanceMeters)
    : 50;
  const raw =
    AUTO_LAYOUT_MIN_SPAN +
    44 * Math.log1p(Math.max(0, safeMeters - 10) / 25);
  const clamped = Math.min(
    AUTO_LAYOUT_MAX_SPAN,
    Math.max(AUTO_LAYOUT_MIN_SPAN, raw)
  );
  const ux = Math.cos(angleUV);
  const uy = Math.sin(angleUV);
  const exitU = aabbRayExitDistance(fpU, ux, uy);
  const exitV = aabbRayExitDistance(fpV, -ux, -uy);
  return Math.max(clamped, exitU + exitV + AUTO_LAYOUT_EDGE_CLEARANCE);
}

interface RawPairCandidate {
  edge: LocationEdge;
  isForwardUV: boolean;
}

/**
 * Reduce projected edges per unordered visible endpoint pair, preferring
 * non-secret passages over secret passages and orienting reverse edges via
 * `OPPOSITE_COMPASS`.
 */
export function reduceVisibleEdgesForAutoLayout(
  projectedTopology: ProjectedDepthTopology,
  footprints: Record<string, NodeFootprint>
): ReducedLayoutEdge[] {
  const visibleIds = new Set<string>([
    ...projectedTopology.visibleLocations.map((l) => l.id),
    ...projectedTopology.visibleSupernodes.map((s) => s.container.id),
  ]);

  const pairMap = new Map<
    string,
    { u: string; v: string; candidates: RawPairCandidate[] }
  >();

  for (const pe of projectedTopology.projectedEdges) {
    if (pe.sourceNodeId === pe.targetNodeId) continue;
    if (!visibleIds.has(pe.sourceNodeId) || !visibleIds.has(pe.targetNodeId)) {
      continue;
    }
    const u =
      pe.sourceNodeId <= pe.targetNodeId ? pe.sourceNodeId : pe.targetNodeId;
    const v =
      pe.sourceNodeId <= pe.targetNodeId ? pe.targetNodeId : pe.sourceNodeId;
    const key = `${u}<->${v}`;
    let entry = pairMap.get(key);
    if (!entry) {
      entry = { u, v, candidates: [] };
      pairMap.set(key, entry);
    }
    const rawList =
      pe.groupedEdges && pe.groupedEdges.length > 0
        ? pe.groupedEdges
        : [pe.rawEdge];
    for (const raw of rawList) {
      // Determine orientation in visible node space: pe goes pe.sourceNodeId -> pe.targetNodeId,
      // while raw may point in either direction when aggregated across container boundaries.
      const isForwardUV =
        raw.from_location_id === pe.sourceNodeId
          ? pe.sourceNodeId === u
          : raw.to_location_id === pe.sourceNodeId
          ? pe.targetNodeId === u
          : pe.sourceNodeId === u;
      entry.candidates.push({ edge: raw, isForwardUV });
    }
  }

  const sortedKeys = Array.from(pairMap.keys()).sort((a, b) =>
    a.localeCompare(b)
  );
  const reduced: ReducedLayoutEdge[] = [];

  for (const key of sortedKeys) {
    const { u, v, candidates } = pairMap.get(key)!;
    if (candidates.length === 0) continue;

    const nonSecret = candidates.filter((c) => !c.edge.is_secret);
    const usedSecretFallback = nonSecret.length === 0;
    const chosen = usedSecretFallback ? candidates : nonSecret;

    let minMeters = Infinity;
    let sumX = 0;
    let sumY = 0;
    let firstDir: CompassDirection = "E";

    chosen.forEach((cand, idx) => {
      const meters = Number.isFinite(cand.edge.distance_meters)
        ? Math.max(1, cand.edge.distance_meters)
        : 50;
      if (meters < minMeters) minMeters = meters;

      const rawDir =
        cand.edge.compass_direction &&
        COMPASS_ORDER.includes(cand.edge.compass_direction)
          ? cand.edge.compass_direction
          : inferCompassDirection(null, cand.edge.direction_label);
      const orientedDir = cand.isForwardUV ? rawDir : OPPOSITE_COMPASS[rawDir];
      if (idx === 0) firstDir = orientedDir;
      const rad = COMPASS_ANGLES[orientedDir];
      sumX += Math.cos(rad);
      sumY += Math.sin(rad);
    });

    const distanceMeters = Number.isFinite(minMeters) ? minMeters : 50;
    const angleUV =
      Math.hypot(sumX, sumY) > 1e-4
        ? Math.atan2(sumY, sumX)
        : COMPASS_ANGLES[firstDir];

    const targetLength = computeAutoLayoutEdgeLength(
      distanceMeters,
      getFootprint(u, footprints),
      getFootprint(v, footprints),
      angleUV
    );

    reduced.push({
      u,
      v,
      angleUV,
      distanceMeters,
      targetLength,
      usedSecretFallback,
    });
  }

  return reduced;
}

/**
 * Compute deterministic, compass- and distance-driven coordinates strictly scoped
 * to the currently visible locations, direct child supernodes, and external ghost
 * portals of `projectedTopology`.
 */
export function computeScopedAutoLayout({
  projectedTopology,
  footprints,
}: ScopedAutoLayoutInput): ScopedAutoLayoutResult {
  const visibleNodeIds = [
    ...projectedTopology.visibleLocations.map((l) => l.id),
    ...projectedTopology.visibleSupernodes.map((s) => s.container.id),
  ];
  if (visibleNodeIds.length === 0) {
    return { coords: {}, ghostCoords: {} };
  }

  const reducedEdges = reduceVisibleEdgesForAutoLayout(
    projectedTopology,
    footprints
  );

  const adj = new Map<string, Array<{ neighbor: string; edge: ReducedLayoutEdge }>>();
  for (const id of visibleNodeIds) {
    adj.set(id, []);
  }
  for (const edge of reducedEdges) {
    adj.get(edge.u)?.push({ neighbor: edge.v, edge });
    adj.get(edge.v)?.push({ neighbor: edge.u, edge });
  }
  for (const list of adj.values()) {
    list.sort((a, b) => a.neighbor.localeCompare(b.neighbor));
  }

  // Partition into connected components deterministically
  const visited = new Set<string>();
  const components: string[][] = [];
  const sortedNodeIds = [...visibleNodeIds].sort((a, b) => a.localeCompare(b));

  for (const startId of sortedNodeIds) {
    if (visited.has(startId)) continue;
    const comp: string[] = [];
    const queue = [startId];
    visited.add(startId);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      comp.push(curr);
      for (const item of adj.get(curr) ?? []) {
        if (!visited.has(item.neighbor)) {
          visited.add(item.neighbor);
          queue.push(item.neighbor);
        }
      }
    }
    comp.sort((a, b) => a.localeCompare(b));
    components.push(comp);
  }

  const anchorId = projectedTopology.anchorNodeId;
  components.sort((a, b) => {
    const aHasAnchor = Boolean(anchorId && a.includes(anchorId));
    const bHasAnchor = Boolean(anchorId && b.includes(anchorId));
    if (aHasAnchor !== bHasAnchor) return aHasAnchor ? -1 : 1;
    if (a.length !== b.length) return b.length - a.length;
    return a[0].localeCompare(b[0]);
  });

  interface PlacedComponent {
    nodeIds: string[];
    pos: Record<string, { x: number; y: number }>;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  }

  const placedComponents: PlacedComponent[] = [];

  for (const comp of components) {
    const compSet = new Set(comp);
    const compEdges = reducedEdges.filter(
      (e) => compSet.has(e.u) && compSet.has(e.v)
    );

    let root = comp[0];
    if (anchorId && compSet.has(anchorId)) {
      root = anchorId;
    } else {
      let bestDeg = -1;
      for (const id of comp) {
        const deg = adj.get(id)?.length ?? 0;
        if (deg > bestDeg || (deg === bestDeg && id.localeCompare(root) < 0)) {
          bestDeg = deg;
          root = id;
        }
      }
    }

    const pos: Record<string, { x: number; y: number }> = {
      [root]: { x: 0, y: 0 },
    };

    // Phase A: Compass-guided BFS seed
    const bfsQueue = [root];
    const seeded = new Set<string>([root]);
    while (bfsQueue.length > 0) {
      const curr = bfsQueue.shift()!;
      const currPt = pos[curr];
      for (const item of adj.get(curr) ?? []) {
        if (seeded.has(item.neighbor)) continue;
        seeded.add(item.neighbor);
        const angle =
          item.edge.u === curr ? item.edge.angleUV : item.edge.angleUV + Math.PI;
        pos[item.neighbor] = {
          x: currPt.x + Math.cos(angle) * item.edge.targetLength,
          y: currPt.y + Math.sin(angle) * item.edge.targetLength,
        };
        bfsQueue.push(item.neighbor);
      }
    }

    // Phase B: Directional stress/spring refinement for cycles & multi-path links
    if (compEdges.length > 0 && comp.length > 1) {
      const stressIterations = 60;
      for (let iter = 0; iter < stressIterations; iter++) {
        const t = iter / Math.max(1, stressIterations - 1);
        const step = 0.35 - t * 0.3; // 0.35 -> 0.05
        const accumX: Record<string, number> = {};
        const accumY: Record<string, number> = {};
        for (const id of comp) {
          accumX[id] = 0;
          accumY[id] = 0;
        }

        for (const edge of compEdges) {
          const pu = pos[edge.u];
          const pv = pos[edge.v];
          const tx = Math.cos(edge.angleUV) * edge.targetLength;
          const ty = Math.sin(edge.angleUV) * edge.targetLength;
          const errX = pv.x - pu.x - tx;
          const errY = pv.y - pu.y - ty;
          const uFixed = edge.u === root;
          const vFixed = edge.v === root;
          if (uFixed && vFixed) continue;
          if (uFixed) {
            accumX[edge.v] -= errX * step;
            accumY[edge.v] -= errY * step;
          } else if (vFixed) {
            accumX[edge.u] += errX * step;
            accumY[edge.u] += errY * step;
          } else {
            accumX[edge.u] += errX * step * 0.5;
            accumY[edge.u] += errY * step * 0.5;
            accumX[edge.v] -= errX * step * 0.5;
            accumY[edge.v] -= errY * step * 0.5;
          }
        }

        for (const id of comp) {
          if (id === root) continue;
          pos[id].x += accumX[id];
          pos[id].y += accumY[id];
        }
      }
    }

    // Phase C: Box-aware AABB overlap separation using real node footprints
    if (comp.length > 1) {
      const sepIterations = 48;
      for (let iter = 0; iter < sepIterations; iter++) {
        let moved = false;
        for (let i = 0; i < comp.length; i++) {
          for (let j = i + 1; j < comp.length; j++) {
            const idA = comp[i];
            const idB = comp[j];
            const fpA = getFootprint(idA, footprints);
            const fpB = getFootprint(idB, footprints);
            const reqX = fpA.halfW + fpB.halfW + AUTO_LAYOUT_BOX_PAD;
            const reqY = fpA.halfH + fpB.halfH + AUTO_LAYOUT_BOX_PAD;
            const pA = pos[idA];
            const pB = pos[idB];
            const dx = pB.x - pA.x;
            const dy = pB.y - pA.y;
            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);
            if (absDx >= reqX || absDy >= reqY) continue;

            moved = true;
            const ox = reqX - absDx;
            const oy = reqY - absDy;
            const aFixed = idA === root;
            const bFixed = idB === root;

            if (ox <= oy) {
              const dir =
                absDx > 1e-4
                  ? dx >= 0
                    ? 1
                    : -1
                  : idA.localeCompare(idB) <= 0
                  ? 1
                  : -1;
              const shift = ox + 2;
              if (aFixed) {
                pB.x += dir * shift;
              } else if (bFixed) {
                pA.x -= dir * shift;
              } else {
                pA.x -= dir * shift * 0.5;
                pB.x += dir * shift * 0.5;
              }
            } else {
              const dir =
                absDy > 1e-4
                  ? dy >= 0
                    ? 1
                    : -1
                  : idA.localeCompare(idB) <= 0
                  ? 1
                  : -1;
              const shift = oy + 2;
              if (aFixed) {
                pB.y += dir * shift;
              } else if (bFixed) {
                pA.y -= dir * shift;
              } else {
                pA.y -= dir * shift * 0.5;
                pB.y += dir * shift * 0.5;
              }
            }
          }
        }
        if (!moved) break;
      }
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const id of comp) {
      const pt = pos[id];
      const fp = getFootprint(id, footprints);
      minX = Math.min(minX, pt.x - fp.halfW);
      maxX = Math.max(maxX, pt.x + fp.halfW);
      minY = Math.min(minY, pt.y - fp.halfH);
      maxY = Math.max(maxY, pt.y + fp.halfH);
    }

    placedComponents.push({
      nodeIds: comp,
      pos,
      minX,
      maxX,
      minY,
      maxY,
    });
  }

  // Phase D: Pack disconnected components in a tidy right-hand shelf
  const coords: Record<string, { x: number; y: number }> = {};
  const primary = placedComponents[0];
  for (const id of primary.nodeIds) {
    coords[id] = {
      x: Math.round(primary.pos[id].x),
      y: Math.round(primary.pos[id].y),
    };
  }

  if (placedComponents.length > 1) {
    const primaryW = Math.max(120, primary.maxX - primary.minX);
    const shelfStartX = primary.maxX + AUTO_LAYOUT_COMPONENT_GAP;
    const maxRowWidth = Math.max(720, primaryW * 1.35);
    let cursorX = shelfStartX;
    let rowTopY = primary.minY;
    let rowMaxY = primary.minY;

    for (let idx = 1; idx < placedComponents.length; idx++) {
      const comp = placedComponents[idx];
      const compW = Math.max(60, comp.maxX - comp.minX);
      const compH = Math.max(60, comp.maxY - comp.minY);
      if (
        cursorX > shelfStartX &&
        cursorX - shelfStartX + compW > maxRowWidth
      ) {
        cursorX = shelfStartX;
        rowTopY = rowMaxY + AUTO_LAYOUT_COMPONENT_GAP;
        rowMaxY = rowTopY;
      }
      const dx = cursorX - comp.minX;
      const dy = rowTopY - comp.minY;
      for (const id of comp.nodeIds) {
        coords[id] = {
          x: Math.round(comp.pos[id].x + dx),
          y: Math.round(comp.pos[id].y + dy),
        };
      }
      cursorX += compW + AUTO_LAYOUT_COMPONENT_GAP;
      rowMaxY = Math.max(rowMaxY, rowTopY + compH);
    }
  }

  const ghostCoords =
    projectedTopology.currentContainer &&
    projectedTopology.ghostExternalNodes.length > 0
      ? computeGhostNodeCoords(
          projectedTopology.ghostExternalNodes,
          projectedTopology.ghostEdges,
          coords,
          undefined,
          footprints
        )
      : {};

  return { coords, ghostCoords };
}

/**
 * Compute camera `{ pan, zoom }` framing all visible nodes and ghost portals
 * comfortably inside `viewBox`, leaving clearance for the top Preview bar.
 */
export function computeViewportFitForCoords(params: {
  coords: Record<string, { x: number; y: number }>;
  ghostCoords?: Record<string, { x: number; y: number }>;
  footprints?: Record<string, NodeFootprint>;
  viewBox: Pick<MapViewBox, "width" | "height">;
  isMobileViewport?: boolean;
}): { pan: { x: number; y: number }; zoom: number } {
  const {
    coords,
    ghostCoords = {},
    footprints = {},
    viewBox,
    isMobileViewport = false,
  } = params;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let count = 0;

  for (const [id, pt] of Object.entries(coords)) {
    const fp = getFootprint(id, footprints);
    minX = Math.min(minX, pt.x - fp.halfW);
    maxX = Math.max(maxX, pt.x + fp.halfW);
    minY = Math.min(minY, pt.y - fp.halfH);
    maxY = Math.max(maxY, pt.y + fp.halfH);
    count++;
  }

  for (const pt of Object.values(ghostCoords)) {
    const hw = GHOST_CARD_HALF_W + 6;
    const hh = GHOST_CARD_HALF_H + 6;
    minX = Math.min(minX, pt.x - hw);
    maxX = Math.max(maxX, pt.x + hw);
    minY = Math.min(minY, pt.y - hh);
    maxY = Math.max(maxY, pt.y + hh);
    count++;
  }

  if (count === 0) {
    return { pan: { x: 0, y: 0 }, zoom: 1 };
  }

  const margin = isMobileViewport ? 40 : 68;
  const availW = Math.max(120, viewBox.width - margin * 2);
  const availH = Math.max(120, viewBox.height - margin * 2 - 36);
  const boxW = Math.max(1, maxX - minX);
  const boxH = Math.max(1, maxY - minY);

  const rawZoom = Math.min(
    availW / boxW,
    availH / boxH,
    AUTO_LAYOUT_FIT_MAX_ZOOM
  );
  const zoom = clampZoom(rawZoom);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return {
    pan: {
      x: Math.round(-centerX),
      y: Math.round(-centerY + 14 / Math.max(0.1, zoom)),
    },
    zoom,
  };
}
