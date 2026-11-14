import type {
  CompassDirection,
  LocationContainer,
  LocationEdge,
  LocationNode,
} from "../../types";

export interface NodeDragState {
  kind: "location" | "container";
  id: string;
  startClientX: number;
  startClientY: number;
  pointerOffsetX: number;
  pointerOffsetY: number;
  origX: number;
  origY: number;
  currX: number;
  currY: number;
  hasMoved: boolean;
  hoverTarget: {
    kind: "location" | "container";
    id: string;
    valid: boolean;
    reason?: string;
  } | null;
}

export interface LinkDragState {
  sourceKind: "location" | "container";
  sourceId: string;
  sourceSlot: CompassDirection;
  startX: number;
  startY: number;
  currX: number;
  currY: number;
  hoverTarget: {
    kind: "location" | "container";
    id: string;
    slot?: CompassDirection;
  } | null;
}

export const COMPASS_ORDER: CompassDirection[] = [
  "N",
  "NE",
  "E",
  "SE",
  "S",
  "SW",
  "W",
  "NW",
];

export const OPPOSITE_COMPASS: Record<CompassDirection, CompassDirection> = {
  N: "S",
  NE: "SW",
  E: "W",
  SE: "NW",
  S: "N",
  SW: "NE",
  W: "E",
  NW: "SE",
};

export const COMPASS_ANGLES: Record<CompassDirection, number> = {
  N: -Math.PI / 2,
  NE: -Math.PI / 4,
  E: 0,
  SE: Math.PI / 4,
  S: Math.PI / 2,
  SW: (3 * Math.PI) / 4,
  W: Math.PI,
  NW: (-3 * Math.PI) / 4,
};

export function inferCompassDirection(
  rawDir?: string | null,
  fallbackText = ""
): CompassDirection {
  if (rawDir) {
    const cleaned = rawDir.replace(/[^A-Za-z]/g, "").toUpperCase();
    const aliasMap: Record<string, CompassDirection> = {
      N: "N",
      NORTH: "N",
      NE: "NE",
      NORTHEAST: "NE",
      E: "E",
      EAST: "E",
      SE: "SE",
      SOUTHEAST: "SE",
      S: "S",
      SOUTH: "S",
      SW: "SW",
      SOUTHWEST: "SW",
      W: "W",
      WEST: "W",
      NW: "NW",
      NORTHWEST: "NW",
    };
    if (aliasMap[cleaned]) return aliasMap[cleaned];
  }
  const low = `${rawDir ?? ""} ${fallbackText}`.toLowerCase();
  const patterns: Array<[RegExp, CompassDirection]> = [
    [/\b(north[\s-]?east|ne)\b/, "NE"],
    [/\b(north[\s-]?west|nw)\b/, "NW"],
    [/\b(south[\s-]?east|se)\b/, "SE"],
    [/\b(south[\s-]?west|sw)\b/, "SW"],
    [/\b(north|northern|back|rear|behind|upstairs|up|above|mezzanine|roof)\b/, "N"],
    [/\b(east|eastern|right|starboard)\b/, "E"],
    [/\b(south|southern|front|street|outside|downstairs|down|below|basement|sub-basement|hatch|cellar)\b/, "S"],
    [/\b(west|western|left|port|alley|side)\b/, "W"],
  ];
  for (const [pat, cdir] of patterns) {
    if (pat.test(low)) return cdir;
  }
  return "N";
}

export function pickCompassSlot(
  preferred: CompassDirection | null | undefined,
  occupied: Set<CompassDirection>
): CompassDirection {
  const base: CompassDirection =
    preferred && COMPASS_ORDER.includes(preferred) ? preferred : "N";
  if (!occupied.has(base)) return base;
  const startIdx = COMPASS_ORDER.indexOf(base);
  for (let offset = 1; offset < COMPASS_ORDER.length; offset++) {
    for (const sign of [1, -1]) {
      const idx =
        (startIdx + offset * sign + COMPASS_ORDER.length) % COMPASS_ORDER.length;
      const cand = COMPASS_ORDER[idx];
      if (!occupied.has(cand)) return cand;
    }
  }
  return base;
}

export function compassFromVector(dx: number, dy: number): CompassDirection {
  const angle = Math.atan2(dy, dx);
  let best: CompassDirection = "N";
  let bestDiff = Infinity;
  for (const dir of COMPASS_ORDER) {
    const a = COMPASS_ANGLES[dir];
    let diff = Math.abs(angle - a);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    if (diff < bestDiff) {
      bestDiff = diff;
      best = dir;
    }
  }
  return best;
}

export const CONTAINER_DEPTH_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: "Building / Landmark",
  2: "District / Zone",
  3: "City / Settlement",
  4: "Region / Planet / Realm",
};

export interface ProjectedContainerSupernode {
  container: LocationContainer;
  directLocationCount: number;
  descendantLocationCount: number;
  externalPortalsCount: number;
  hasActivePlayer: boolean;
  presentCharacterIds: string[];
  representativePortalLocationId: string | null;
}

export interface ProjectedTopologyEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  direction_label: string;
  compass_direction?: CompassDirection | null;
  travel_minutes: number;
  is_locked_or_hidden: boolean;
  isAggregated: boolean;
  containsLockedEdge: boolean;
  rawEdge: LocationEdge;
  groupedEdges?: LocationEdge[];
}

export interface ProjectedExternalPortalDestination {
  edge: LocationEdge;
  destination: LocationNode;
  destinationContainerName: string | null;
}

export interface ProjectedDepthTopology {
  currentContainer: LocationContainer | null;
  breadcrumbs: LocationContainer[];
  visibleLocations: LocationNode[];
  visibleSupernodes: ProjectedContainerSupernode[];
  projectedEdges: ProjectedTopologyEdge[];
  dynamicPortalIds: Set<string>;
  externalPortalsByLocationId: Record<
    string,
    ProjectedExternalPortalDestination[]
  >;
  anchorNodeId: string;
}

/** Build root-to-leaf ancestor chain [L4, ..., target] for any container ID. */
export function buildContainerBreadcrumbChain(
  containerId: string | null | undefined,
  containers: LocationContainer[]
): LocationContainer[] {
  if (!containerId || containers.length === 0) return [];
  const byId = new Map(containers.map((c) => [c.id, c]));
  const chainRev: LocationContainer[] = [];
  const seen = new Set<string>();
  let currId: string | null | undefined = containerId;
  while (currId && byId.has(currId) && !seen.has(currId)) {
    seen.add(currId);
    const curr: LocationContainer = byId.get(currId)!;
    chainRev.push(curr);
    currId = curr.parent_container_id ?? null;
  }
  return chainRev.reverse();
}

/** Determine dynamic portals: static is_entry_exit OR active cross-boundary edge endpoint. */
export function computeDynamicPortalIds(
  locations: LocationNode[],
  edges: LocationEdge[]
): Set<string> {
  const locContainer = new Map<string, string | null>(
    locations.map((l) => [l.id, l.container_id ?? null])
  );
  const portals = new Set<string>();
  for (const loc of locations) {
    if (loc.is_entry_exit) portals.add(loc.id);
  }
  for (const edge of edges) {
    if (
      !locContainer.has(edge.from_location_id) ||
      !locContainer.has(edge.to_location_id)
    ) {
      continue;
    }
    const cFrom = locContainer.get(edge.from_location_id) ?? null;
    const cTo = locContainer.get(edge.to_location_id) ?? null;
    if (cFrom !== cTo) {
      if (cFrom !== null) portals.add(edge.from_location_id);
      if (cTo !== null) portals.add(edge.to_location_id);
    }
  }
  return portals;
}

/**
 * Pure depth-projection selector mapping full Level 0 locations and Level 1-4 containers
 * into the visible nodes, aggregated supernodes, and edges for `currentContainerId`.
 */
export function projectTopologyForDepth(
  currentContainerId: string | null,
  containers: LocationContainer[],
  locations: LocationNode[],
  edges: LocationEdge[],
  activeLocationId?: string,
  presentCharacterLocations?: Record<string, string>
): ProjectedDepthTopology {
  const byId = new Map(containers.map((c) => [c.id, c]));
  const validCurrentId =
    currentContainerId && byId.has(currentContainerId) ? currentContainerId : null;
  const currentContainer = validCurrentId ? byId.get(validCurrentId) ?? null : null;
  const breadcrumbs = buildContainerBreadcrumbChain(validCurrentId, containers);

  const dynamicPortalIds = computeDynamicPortalIds(locations, edges);
  const childContainers = containers.filter(
    (c) => (c.parent_container_id ?? null) === validCurrentId
  );
  const childContainerIds = new Set(childContainers.map((c) => c.id));

  const ancestorCache = new Map<string, string | null>();
  const resolveChildUnderCurrent = (
    containerId: string | null | undefined
  ): string | null => {
    if (!containerId || !byId.has(containerId)) return null;
    if (ancestorCache.has(containerId)) return ancestorCache.get(containerId)!;
    const seen = new Set<string>();
    let curr: string | null | undefined = containerId;
    while (curr && byId.has(curr) && !seen.has(curr)) {
      seen.add(curr);
      if (curr === validCurrentId) {
        ancestorCache.set(containerId, null);
        return null;
      }
      if (childContainerIds.has(curr)) {
        ancestorCache.set(containerId, curr);
        return curr;
      }
      curr = byId.get(curr)!.parent_container_id ?? null;
    }
    ancestorCache.set(containerId, null);
    return null;
  };

  type VisibleMapping =
    | { kind: "location"; id: string }
    | { kind: "container"; id: string };

  const visibleByLocId = new Map<string, VisibleMapping>();
  const visibleLocations: LocationNode[] = [];
  const descendantLocsBySupernode = new Map<string, LocationNode[]>();
  for (const cc of childContainers) {
    descendantLocsBySupernode.set(cc.id, []);
  }

  for (const loc of locations) {
    const locContId =
      loc.container_id && byId.has(loc.container_id) ? loc.container_id : null;
    if (locContId === validCurrentId) {
      visibleLocations.push(loc);
      visibleByLocId.set(loc.id, { kind: "location", id: loc.id });
    } else {
      const childSupId = resolveChildUnderCurrent(locContId);
      if (childSupId) {
        descendantLocsBySupernode.get(childSupId)!.push(loc);
        visibleByLocId.set(loc.id, { kind: "container", id: childSupId });
      }
    }
  }

  const charsAtLoc = new Map<string, string[]>();
  if (presentCharacterLocations) {
    for (const [charId, locId] of Object.entries(presentCharacterLocations)) {
      if (!charsAtLoc.has(locId)) charsAtLoc.set(locId, []);
      charsAtLoc.get(locId)!.push(charId);
    }
  }

  const visibleSupernodes: ProjectedContainerSupernode[] = childContainers.map(
    (cc) => {
      const descendants = descendantLocsBySupernode.get(cc.id) ?? [];
      const directCount = descendants.filter((l) => l.container_id === cc.id).length;
      const portalDesc = descendants.filter((l) => dynamicPortalIds.has(l.id));
      const presentIds: string[] = [];
      for (const d of descendants) {
        const list = charsAtLoc.get(d.id);
        if (list) presentIds.push(...list);
      }
      const activeLocMapping = activeLocationId
        ? visibleByLocId.get(activeLocationId)
        : undefined;
      const hasActivePlayer =
        (activeLocMapping?.kind === "container" && activeLocMapping.id === cc.id) ||
        descendants.some((d) => d.id === activeLocationId);
      return {
        container: cc,
        directLocationCount: directCount,
        descendantLocationCount: descendants.length,
        externalPortalsCount: portalDesc.length,
        hasActivePlayer,
        presentCharacterIds: presentIds,
        representativePortalLocationId:
          portalDesc[0]?.id ?? descendants[0]?.id ?? null,
      };
    }
  );

  const locMap = new Map(locations.map((l) => [l.id, l]));
  const externalPortalsByLocationId: Record<
    string,
    ProjectedExternalPortalDestination[]
  > = {};
  const projectedEdges: ProjectedTopologyEdge[] = [];
  const aggregatedGroups = new Map<
    string,
    { sourceNodeId: string; targetNodeId: string; edges: LocationEdge[] }
  >();

  for (const edge of edges) {
    const fromVis = visibleByLocId.get(edge.from_location_id);
    const toVis = visibleByLocId.get(edge.to_location_id);

    if (fromVis && !toVis) {
      if (fromVis.kind === "location") {
        const dest = locMap.get(edge.to_location_id);
        if (dest) {
          if (!externalPortalsByLocationId[edge.from_location_id]) {
            externalPortalsByLocationId[edge.from_location_id] = [];
          }
          const destContName =
            dest.container_id && byId.has(dest.container_id)
              ? byId.get(dest.container_id)!.name
              : "World Root";
          externalPortalsByLocationId[edge.from_location_id].push({
            edge,
            destination: dest,
            destinationContainerName: destContName,
          });
        }
      }
      continue;
    }

    if (!fromVis || !toVis) continue;
    if (fromVis.id === toVis.id) continue;

    if (fromVis.kind === "location" && toVis.kind === "location") {
      projectedEdges.push({
        id: edge.id,
        sourceNodeId: fromVis.id,
        targetNodeId: toVis.id,
        direction_label: edge.direction_label,
        compass_direction: edge.compass_direction,
        travel_minutes: edge.travel_minutes,
        is_locked_or_hidden: edge.is_locked_or_hidden,
        isAggregated: false,
        containsLockedEdge: edge.is_locked_or_hidden,
        rawEdge: edge,
      });
    } else {
      const groupKey = `${fromVis.id}=>${toVis.id}`;
      if (!aggregatedGroups.has(groupKey)) {
        aggregatedGroups.set(groupKey, {
          sourceNodeId: fromVis.id,
          targetNodeId: toVis.id,
          edges: [],
        });
      }
      aggregatedGroups.get(groupKey)!.edges.push(edge);
    }
  }

  for (const [groupKey, group] of aggregatedGroups.entries()) {
    const first = group.edges[0];
    const minMinutes = Math.min(...group.edges.map((e) => e.travel_minutes));
    const anyLocked = group.edges.some((e) => e.is_locked_or_hidden);
    projectedEdges.push({
      id: `agg:${groupKey}`,
      sourceNodeId: group.sourceNodeId,
      targetNodeId: group.targetNodeId,
      direction_label:
        group.edges.length > 1
          ? `${group.edges.length} passages`
          : first.direction_label,
      compass_direction: first.compass_direction,
      travel_minutes: minMinutes,
      is_locked_or_hidden: anyLocked,
      isAggregated: true,
      containsLockedEdge: anyLocked,
      rawEdge: first,
      groupedEdges: group.edges,
    });
  }

  const activeVis = activeLocationId
    ? visibleByLocId.get(activeLocationId)
    : undefined;
  const portalInCurrent = visibleLocations.find((l) =>
    dynamicPortalIds.has(l.id)
  );
  const anchorNodeId =
    activeVis?.id ??
    portalInCurrent?.id ??
    visibleLocations[0]?.id ??
    visibleSupernodes[0]?.container.id ??
    "";

  return {
    currentContainer,
    breadcrumbs,
    visibleLocations,
    visibleSupernodes,
    projectedEdges,
    dynamicPortalIds,
    externalPortalsByLocationId,
    anchorNodeId,
  };
}

/**
 * Resolve canvas coordinates, keeping nodes with persisted ui_x/ui_y pinned
 * while auto-placing any null-coordinate nodes via compass BFS & repulsion.
 */
export function computeFullMapCoords(
  locations: LocationNode[],
  edges: LocationEdge[],
  activeLocId: string
): Record<string, { x: number; y: number }> {
  const coords: Record<string, { x: number; y: number }> = {};
  if (locations.length === 0) return coords;

  const locById = new Map(locations.map((l) => [l.id, l]));
  const pinnedIds = new Set<string>();
  const placed = new Set<string>();

  for (const loc of locations) {
    if (
      typeof loc.ui_x === "number" &&
      Number.isFinite(loc.ui_x) &&
      typeof loc.ui_y === "number" &&
      Number.isFinite(loc.ui_y)
    ) {
      coords[loc.id] = { x: loc.ui_x, y: loc.ui_y };
      pinnedIds.add(loc.id);
      placed.add(loc.id);
    }
  }

  const startId = locById.has(activeLocId) ? activeLocId : locations[0].id;
  if (!coords[startId]) {
    coords[startId] = { x: 0, y: 0 };
    placed.add(startId);
  }

  const adj = new Map<string, Array<{ to: string; dir: CompassDirection }>>();
  for (const e of edges) {
    if (!locById.has(e.from_location_id) || !locById.has(e.to_location_id)) {
      continue;
    }
    const d: CompassDirection =
      e.compass_direction && COMPASS_ORDER.includes(e.compass_direction)
        ? e.compass_direction
        : "N";
    if (!adj.has(e.from_location_id)) adj.set(e.from_location_id, []);
    adj.get(e.from_location_id)!.push({ to: e.to_location_id, dir: d });
  }

  const stepDist = 175;
  const seedQueue = Array.from(placed);
  while (seedQueue.length > 0) {
    const curr = seedQueue.shift()!;
    const currPt = coords[curr];
    const outgoing = adj.get(curr) ?? [];
    const usedSlots = new Set<CompassDirection>();

    for (const item of outgoing) {
      if (placed.has(item.to)) continue;
      placed.add(item.to);
      const slot = pickCompassSlot(item.dir, usedSlots);
      usedSlots.add(slot);
      const angle = COMPASS_ANGLES[slot];
      coords[item.to] = {
        x: currPt.x + Math.cos(angle) * stepDist,
        y: currPt.y + Math.sin(angle) * stepDist,
      };
      seedQueue.push(item.to);
    }
  }

  const unplaced = locations.filter((l) => !placed.has(l.id));
  unplaced.forEach((loc, idx) => {
    const angle =
      (idx / Math.max(1, unplaced.length)) * Math.PI * 2 - Math.PI / 2;
    coords[loc.id] = {
      x: Math.cos(angle) * (stepDist * 2.1),
      y: Math.sin(angle) * (stepDist * 2.1),
    };
  });

  const ids = Object.keys(coords);
  const minDist = 115;
  for (let iter = 0; iter < 36; iter++) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const idA = ids[i];
        const idB = ids[j];
        const aFixed = pinnedIds.has(idA) || idA === startId;
        const bFixed = pinnedIds.has(idB) || idB === startId;
        if (aFixed && bFixed) continue;

        const pA = coords[idA];
        const pB = coords[idB];
        let dx = pB.x - pA.x;
        let dy = pB.y - pA.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 1) {
          dx = (i + 1) * 7;
          dy = (j + 1) * 5;
          dist = Math.hypot(dx, dy);
        }
        if (dist < minDist) {
          const push = ((minDist - dist) / dist) * 0.5;
          const ox = dx * push;
          const oy = dy * push;
          if (aFixed) {
            pB.x += ox * 2;
            pB.y += oy * 2;
          } else if (bFixed) {
            pA.x -= ox * 2;
            pA.y -= oy * 2;
          } else {
            pA.x -= ox;
            pA.y -= oy;
            pB.x += ox;
            pB.y += oy;
          }
        }
      }
    }
  }

  for (const id of ids) {
    coords[id] = {
      x: Math.round(coords[id].x),
      y: Math.round(coords[id].y),
    };
  }
  return coords;
}

export interface PromotionCandidate {
  location: LocationNode;
  container: LocationContainer;
  promote: boolean;
}

export interface PromotionPromptState {
  fromLocation: LocationNode;
  toLocation: LocationNode;
  targetContainerForLocationPick: LocationContainer | null;
  targetLocationCandidates: LocationNode[];
  chosenTargetLocationId: string;
  direction: CompassDirection;
  travelMinutes: number;
  bidirectional: boolean;
  candidates: PromotionCandidate[];
}

export function computePromotionCandidates(
  fromLoc: LocationNode,
  toLoc: LocationNode,
  containerMap: Map<string, LocationContainer>,
  dynamicPortalIds: Set<string>
): PromotionCandidate[] {
  const list: PromotionCandidate[] = [];
  const fromContId = fromLoc.container_id ?? null;
  const toContId = toLoc.container_id ?? null;
  if (fromContId === toContId) return list;

  const fromCont = fromContId ? containerMap.get(fromContId) : undefined;
  const toCont = toContId ? containerMap.get(toContId) : undefined;
  if (
    fromCont &&
    fromCont.depth === 1 &&
    !fromLoc.is_entry_exit &&
    !dynamicPortalIds.has(fromLoc.id)
  ) {
    list.push({ location: fromLoc, container: fromCont, promote: true });
  }
  if (
    toCont &&
    toCont.depth === 1 &&
    !toLoc.is_entry_exit &&
    !dynamicPortalIds.has(toLoc.id)
  ) {
    list.push({ location: toLoc, container: toCont, promote: true });
  }
  return list;
}

export interface GraphSnapshot {
  containers: LocationContainer[];
  locations: LocationNode[];
  edges: LocationEdge[];
}

export function cloneGraph(
  containers: LocationContainer[],
  locations: LocationNode[],
  edges: LocationEdge[]
): GraphSnapshot {
  return {
    containers: containers.map((c) => ({
      ...c,
      environmental_tags: [...(c.environmental_tags ?? [])],
      lore_nodes: (c.lore_nodes ?? []).map((ln) => ({
        ...ln,
        entity_tags: [...(ln.entity_tags ?? [])],
      })),
    })),
    locations: locations.map((l) => ({
      ...l,
      environmental_tags: [...(l.environmental_tags ?? [])],
      lore_nodes: (l.lore_nodes ?? []).map((ln) => ({
        ...ln,
        entity_tags: [...(ln.entity_tags ?? [])],
      })),
    })),
    edges: edges.map((e) => ({ ...e })),
  };
}

export function clientToWorldPoint(
  clientX: number,
  clientY: number,
  svgEl: SVGSVGElement | null,
  groupEl: SVGGElement | null,
  pan: { x: number; y: number },
  zoom: number
): { x: number; y: number } {
  if (
    svgEl &&
    groupEl &&
    typeof svgEl.createSVGPoint === "function" &&
    typeof groupEl.getScreenCTM === "function"
  ) {
    const ctm = groupEl.getScreenCTM();
    if (ctm) {
      const pt = svgEl.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const out = pt.matrixTransform(ctm.inverse());
      return { x: out.x, y: out.y };
    }
  }
  const rect = svgEl?.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
  const scale = Math.min(rect.width / 680, rect.height / 520) || 1;
  const vbX = (clientX - (rect.left + rect.width / 2)) / scale;
  const vbY = (clientY - (rect.top + rect.height / 2)) / scale;
  return {
    x: vbX / zoom - pan.x,
    y: vbY / zoom - pan.y,
  };
}

/**
 * Project SVG canvas world coordinates into pixel coordinates relative to a
 * positioning wrapper element (`canvasWrapRef`) for HTML overlay controls.
 */
export function worldPointToWrapperPoint(
  worldX: number,
  worldY: number,
  svgEl: SVGSVGElement | null,
  wrapEl: HTMLElement | null,
  groupEl: SVGGElement | null,
  pan: { x: number; y: number },
  zoom: number
): { x: number; y: number } | null {
  if (!svgEl || !wrapEl) return null;
  const wrapRect = wrapEl.getBoundingClientRect();
  if (wrapRect.width <= 0 || wrapRect.height <= 0) return null;
  const originLeft = wrapRect.left + (wrapEl.clientLeft || 0);
  const originTop = wrapRect.top + (wrapEl.clientTop || 0);

  if (
    groupEl &&
    typeof svgEl.createSVGPoint === "function" &&
    typeof groupEl.getScreenCTM === "function"
  ) {
    const ctm = groupEl.getScreenCTM();
    if (ctm) {
      const pt = svgEl.createSVGPoint();
      pt.x = worldX;
      pt.y = worldY;
      const screenPt = pt.matrixTransform(ctm);
      return {
        x: screenPt.x - originLeft,
        y: screenPt.y - originTop,
      };
    }
  }

  const svgRect = svgEl.getBoundingClientRect();
  if (svgRect.width <= 0 || svgRect.height <= 0) return null;
  const scale = Math.min(svgRect.width / 680, svgRect.height / 520) || 1;
  const vbX = (worldX + pan.x) * zoom;
  const vbY = (worldY + pan.y) * zoom;
  return {
    x: svgRect.left + svgRect.width / 2 + vbX * scale - originLeft,
    y: svgRect.top + svgRect.height / 2 + vbY * scale - originTop,
  };
}

export function makeUniqueId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Clamp and step an inline edge travel-minutes draft string by `delta`,
 * falling back to `fallbackMinutes` when the draft is blank/non-numeric.
 */
export function stepEdgeMinutesDraft(
  rawDraft: string,
  delta: number,
  fallbackMinutes = 1
): string {
  const parsed = parseInt(rawDraft.trim(), 10);
  const base = Number.isFinite(parsed)
    ? parsed
    : Math.max(1, Math.min(240, Math.round(fallbackMinutes) || 1));
  return String(Math.max(1, Math.min(240, base + delta)));
}

/**
 * Resolve an inline edge travel-minutes draft on commit. Returns null when
 * blank/invalid so callers can preserve the edge's existing duration.
 */
export function parseCommittedEdgeMinutes(rawDraft: string): number | null {
  const trimmed = rawDraft.trim();
  if (!trimmed) return null;
  const parsed = parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(1, Math.min(240, parsed));
}

/**
 * Remove the given edge IDs plus their symmetric bidirectional reverse edges
 * from an edge list in a single pure pass.
 */
export function filterEdgesAfterDeletion(
  edges: LocationEdge[],
  edgeIds: string[]
): LocationEdge[] {
  if (edgeIds.length === 0) return edges;
  const targetIds = new Set(edgeIds);
  const targets = edges.filter((e) => targetIds.has(e.id));
  if (targets.length === 0) return edges;

  return edges.filter(
    (edge) =>
      !targetIds.has(edge.id) &&
      !targets.some(
        (t) =>
          edge.from_location_id === t.to_location_id &&
          edge.to_location_id === t.from_location_id
      )
  );
}

export interface InitialMapFocus {
  currentContainerId: string | null;
  focalLocationId: string | null;
  pan: { x: number; y: number };
}

/**
 * Resolve initial container scope and pan offset for a focal location
 * (`activeLocationId`, else `is_starting_location`, else first location).
 */
export function resolveInitialMapFocus(
  containers: LocationContainer[],
  locations: LocationNode[],
  activeLocationId?: string | null
): InitialMapFocus {
  if (locations.length === 0) {
    return {
      currentContainerId: null,
      focalLocationId: null,
      pan: { x: 0, y: 0 },
    };
  }
  const focalLoc =
    (activeLocationId
      ? locations.find((l) => l.id === activeLocationId)
      : undefined) ||
    locations.find((l) => l.is_starting_location) ||
    locations[0];

  const containerIds = new Set(containers.map((c) => c.id));
  const rawContId = focalLoc?.container_id ?? null;
  const currentContainerId =
    rawContId && containerIds.has(rawContId) ? rawContId : null;

  const hasPinnedCoords =
    typeof focalLoc?.ui_x === "number" &&
    Number.isFinite(focalLoc.ui_x) &&
    typeof focalLoc?.ui_y === "number" &&
    Number.isFinite(focalLoc.ui_y);

  const pan = hasPinnedCoords
    ? {
        x: focalLoc.ui_x === 0 ? 0 : -(focalLoc.ui_x as number),
        y: focalLoc.ui_y === 0 ? 0 : -(focalLoc.ui_y as number),
      }
    : { x: 0, y: 0 };

  return {
    currentContainerId,
    focalLocationId: focalLoc?.id ?? null,
    pan,
  };
}
