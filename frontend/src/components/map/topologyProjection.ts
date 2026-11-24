import type {
  CompassDirection,
  LocationContainer,
  LocationEdge,
  LocationNode,
} from "../../types";
export {
  DEFAULT_EDGE_SPEED_MODIFIER,
  DEFAULT_EXTERIOR_DISTANCE_METERS,
  DEFAULT_FALLBACK_DISTANCE_METERS,
  DEFAULT_INTERIOR_DISTANCE_METERS,
  LINK_SPEED_PRESETS,
  MAX_EDGE_DISTANCE_METERS,
  MAX_EDGE_OBSTACLES,
  MAX_EDGE_SPEED_MODIFIER,
  MIN_EDGE_SPEED_MODIFIER,
  WALKING_METERS_PER_MINUTE,
  clampEdgeDistanceMeters,
  clampEdgeSpeedModifier,
  deriveTravelMinutes,
  deriveWalkingMinutes,
  formatBundleTravelDuration,
  formatBundleWalkingDuration,
  formatDistanceCompact,
  formatEffectiveSpeedKmh,
  formatExitTravelPhrase,
  formatTravelDuration,
  formatWalkingDuration,
  getAdaptiveDistanceStep,
  parseCommittedEdgeDistance,
  sanitizeEdgeDistanceInput,
  stepEdgeDistanceDraft,
} from "../../utils/spatialDistance";

export interface NodeDragState {
  kind: "location" | "container" | "ghost";
  id: string;
  pointerId?: number;
  pointerType?: string;
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
  pointerId?: number;
  pointerType?: string;
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

export interface PortReassignDragState {
  locationId: string;
  edgeId: string;
  fromSlot: CompassDirection;
  pointerId?: number;
  pointerType?: string;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  currX: number;
  currY: number;
  hasMoved: boolean;
  hoverSlot: CompassDirection | null;
  hoverSlotBlocked: boolean;
}

export interface PortConnectionPreview {
  edgeId: string;
  fromLocationId: string;
  fromSlot: CompassDirection;
  toLocationId: string;
  toLocationName: string;
  targetKind: "location" | "container" | "ghost";
  targetNodeId: string;
  targetSlot: CompassDirection | null;
  targetContainerName?: string;
  edgePairKey: string | null;
  tooltipText: string;
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

export interface TargetCompassResolution {
  slot: CompassDirection;
  collides: boolean;
  isFallback: boolean;
}

/**
 * Resolve target compass slot when connecting to a target location:
 * - Explicit override uses that exact slot and reports whether it is occupied.
 * - Auto mode starts from OPPOSITE_COMPASS[sourceSlot] and picks the nearest free
 *   port around COMPASS_ORDER, only reporting collision when all 8 ports are full.
 */
export function resolveAutoTargetSlot(
  sourceSlot: CompassDirection,
  targetOccupied: Set<CompassDirection>,
  explicitTargetSlot?: CompassDirection
): TargetCompassResolution {
  if (explicitTargetSlot) {
    return {
      slot: explicitTargetSlot,
      collides: targetOccupied.has(explicitTargetSlot),
      isFallback: false,
    };
  }
  const preferred = OPPOSITE_COMPASS[sourceSlot];
  const chosen = pickCompassSlot(preferred, targetOccupied);
  const collides = targetOccupied.has(chosen);
  return {
    slot: chosen,
    collides,
    isFallback: !collides && chosen !== preferred,
  };
}

/** Map occupied compass directions on a location to their connected destination names. */
export function getLocationOccupiedPorts(
  locationId: string,
  edges: LocationEdge[],
  locationMap: Map<string, LocationNode>,
  excludeEdgeId?: string
): Map<CompassDirection, string> {
  const occupied = new Map<CompassDirection, string>();
  for (const edge of edges) {
    if (edge.from_location_id !== locationId) continue;
    if (excludeEdgeId && edge.id === excludeEdgeId) continue;
    const dir = edge.compass_direction;
    if (!dir || !COMPASS_ORDER.includes(dir)) continue;
    if (!occupied.has(dir)) {
      occupied.set(
        dir,
        locationMap.get(edge.to_location_id)?.name ?? edge.to_location_id
      );
    }
  }
  return occupied;
}

/**
 * Resolve the opposite-end visual target for an occupied outgoing compass port on a location.
 * Supports direct visible locations (including reciprocal port dot), cross-boundary container
 * supernodes (aggregated or single passage), and shared external ghost nodes.
 */
export function resolvePortConnectionPreview(params: {
  locationId: string;
  slot: CompassDirection;
  edges: LocationEdge[];
  projectedTopology: Pick<
    ProjectedDepthTopology,
    | "visibleLocations"
    | "visibleSupernodes"
    | "ghostExternalNodes"
    | "projectedEdges"
    | "ghostEdges"
  >;
  locationMap: Map<string, LocationNode>;
}): PortConnectionPreview | null {
  const { locationId, slot, edges, projectedTopology, locationMap } = params;
  const outgoing = edges.find(
    (e) => e.from_location_id === locationId && e.compass_direction === slot
  );
  if (!outgoing) return null;

  const toLocationId = outgoing.to_location_id;
  const toLocationName = locationMap.get(toLocationId)?.name ?? toLocationId;
  const reciprocal = edges.find(
    (e) => e.from_location_id === toLocationId && e.to_location_id === locationId
  );
  const reciprocalSlot =
    reciprocal?.compass_direction &&
    COMPASS_ORDER.includes(reciprocal.compass_direction)
      ? reciprocal.compass_direction
      : null;

  // 1. Direct visible location in the current view
  if (projectedTopology.visibleLocations.some((l) => l.id === toLocationId)) {
    const edgePairKey = [locationId, toLocationId].sort().join("<->");
    const tooltipText = reciprocalSlot
      ? `${slot} → ${toLocationName} (${reciprocalSlot})`
      : `${slot} → ${toLocationName}`;
    return {
      edgeId: outgoing.id,
      fromLocationId: locationId,
      fromSlot: slot,
      toLocationId,
      toLocationName,
      targetKind: "location",
      targetNodeId: toLocationId,
      targetSlot: reciprocalSlot,
      edgePairKey,
      tooltipText,
    };
  }

  // 2. Shared external ghost node in the current view
  if (
    projectedTopology.ghostExternalNodes.some(
      (g) => g.destination.id === toLocationId
    )
  ) {
    const edgePairKey = `ghost:${[locationId, toLocationId].sort().join("<->")}`;
    const tooltipText = reciprocalSlot
      ? `${slot} → ${toLocationName} (${reciprocalSlot} · external)`
      : `${slot} → ${toLocationName} (external)`;
    return {
      edgeId: outgoing.id,
      fromLocationId: locationId,
      fromSlot: slot,
      toLocationId,
      toLocationName,
      targetKind: "ghost",
      targetNodeId: toLocationId,
      targetSlot: null,
      edgePairKey,
      tooltipText,
    };
  }

  // 3. Cross-boundary link terminating inside a visible container supernode
  const matchedProjected = projectedTopology.projectedEdges.find((pe) => {
    const involvesLocation =
      pe.sourceNodeId === locationId || pe.targetNodeId === locationId;
    if (!involvesLocation) return false;
    return (
      pe.rawEdge.id === outgoing.id ||
      Boolean(pe.groupedEdges?.some((ge) => ge.id === outgoing.id))
    );
  });
  if (matchedProjected) {
    const otherNodeId =
      matchedProjected.sourceNodeId === locationId
        ? matchedProjected.targetNodeId
        : matchedProjected.sourceNodeId;
    const matchedSupernode = projectedTopology.visibleSupernodes.find(
      (sn) => sn.container.id === otherNodeId
    );
    if (matchedSupernode) {
      const containerName = matchedSupernode.container.name;
      const edgePairKey = [
        matchedProjected.sourceNodeId,
        matchedProjected.targetNodeId,
      ]
        .sort()
        .join("<->");
      const tooltipText = reciprocalSlot
        ? `${slot} → ${toLocationName} (${reciprocalSlot}, inside ${containerName})`
        : `${slot} → ${toLocationName} (inside ${containerName})`;
      return {
        edgeId: outgoing.id,
        fromLocationId: locationId,
        fromSlot: slot,
        toLocationId,
        toLocationName,
        targetKind: "container",
        targetNodeId: otherNodeId,
        targetSlot: null,
        targetContainerName: containerName,
        edgePairKey,
        tooltipText,
      };
    }
  }

  return null;
}

/** Build a human-readable ancestor breadcrumb (e.g., "Region › District") for a container. */
export function buildContainerBreadcrumb(
  containerId: string | null | undefined,
  containers: LocationContainer[]
): string {
  const chain = buildContainerBreadcrumbChain(containerId, containers);
  return chain.length > 0 ? chain.map((c) => c.name).join(" › ") : "Top-Level";
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
  distance_meters: number;
  speed_modifier: number;
  travel_mode?: string | null;
  obstacles: string[];
  is_blocked: boolean;
  is_secret: boolean;
  isUndiscoveredSecret: boolean;
  isAggregated: boolean;
  containsBlockedEdge: boolean;
  containsUndiscoveredSecretEdge: boolean;
  containsObstacles: boolean;
  rawEdge: LocationEdge;
  groupedEdges?: LocationEdge[];
}

export interface ProjectedExternalPortalDestination {
  edge: LocationEdge;
  destination: LocationNode;
  destinationContainerName: string | null;
}

export interface ProjectedGhostExternalNode {
  destination: LocationNode;
  destinationContainerName: string;
  connectedPortalIds: string[];
}

export interface ProjectedGhostEdge {
  id: string;
  portalLocationId: string;
  externalLocationId: string;
  sourceNodeId: string;
  targetNodeId: string;
  direction_label: string;
  compass_direction?: CompassDirection | null;
  distance_meters: number;
  speed_modifier: number;
  travel_mode?: string | null;
  obstacles: string[];
  is_blocked: boolean;
  is_secret: boolean;
  isUndiscoveredSecret: boolean;
  rawEdge: LocationEdge;
}

export interface TopologyProjectionOptions {
  mode?: "editor" | "campaign";
  unlockLore?: boolean;
  revealedEdgeIds?: readonly string[];
}

export type SelectedEdgeState =
  | { kind: "pair"; edgeId: string; returnBundleEdgeIds?: string[] }
  | { kind: "bundle"; edgeIds: string[] };

export interface LinkPairInspectorData {
  pairKey: string;
  primary: LocationEdge;
  reciprocal: LocationEdge | null;
}

/** Return canonical unordered endpoint pair key `min<->max` for bidirectional edge matching. */
export function canonicalEdgePairKey(fromId: string, toId: string): string {
  return fromId <= toId ? `${fromId}<->${toId}` : `${toId}<->${fromId}`;
}

/** Derive canonical endpoint pair keys for all edges whose IDs appear in `revealedEdgeIds`. */
export function resolveRevealedEdgePairs(
  edges: readonly LocationEdge[],
  revealedEdgeIds: readonly string[]
): Set<string> {
  const idSet = new Set(revealedEdgeIds.filter(Boolean));
  const pairs = new Set<string>();
  if (idSet.size === 0) return pairs;
  for (const edge of edges) {
    if (idSet.has(edge.id)) {
      pairs.add(canonicalEdgePairKey(edge.from_location_id, edge.to_location_id));
    }
  }
  return pairs;
}

/** Return true if a secret edge has been discovered on the active branch (by ID or pair). */
export function isEdgeRevealed(
  edge: Pick<LocationEdge, "id" | "from_location_id" | "to_location_id">,
  revealedIds: ReadonlySet<string>,
  revealedPairs: ReadonlySet<string>
): boolean {
  return (
    revealedIds.has(edge.id) ||
    revealedPairs.has(canonicalEdgePairKey(edge.from_location_id, edge.to_location_id))
  );
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
  ghostExternalNodes: ProjectedGhostExternalNode[];
  ghostEdges: ProjectedGhostEdge[];
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

/** Collect explicit portal IDs from containerized locations marked with `is_entry_exit`. */
export function computeDynamicPortalIds(
  locations: LocationNode[],
  _edges?: LocationEdge[]
): Set<string> {
  const portals = new Set<string>();
  for (const loc of locations) {
    if (loc.container_id && loc.is_entry_exit) {
      portals.add(loc.id);
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
  presentCharacterLocations?: Record<string, string>,
  options?: TopologyProjectionOptions
): ProjectedDepthTopology {
  const isCampaignPlayerMode =
    options?.mode === "campaign" && !options?.unlockLore;
  const revealedEdgeIdSet = new Set(options?.revealedEdgeIds ?? []);
  const revealedEdgePairs = resolveRevealedEdgePairs(
    edges,
    options?.revealedEdgeIds ?? []
  );
  const isUndiscoveredSecretEdge = (edge: LocationEdge): boolean => {
    if (!edge.is_secret) return false;
    if (options?.mode === "campaign") {
      return !isEdgeRevealed(edge, revealedEdgeIdSet, revealedEdgePairs);
    }
    return true;
  };
  const visibleInputEdges = isCampaignPlayerMode
    ? edges.filter((edge) => !isUndiscoveredSecretEdge(edge))
    : edges;
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
  const ghostMap = new Map<string, ProjectedGhostExternalNode>();
  const ghostEdges: ProjectedGhostEdge[] = [];
  const projectedEdges: ProjectedTopologyEdge[] = [];
  const aggregatedGroups = new Map<
    string,
    { sourceNodeId: string; targetNodeId: string; edges: LocationEdge[] }
  >();

  const registerGhostLink = (
    edge: LocationEdge,
    portalLocId: string,
    extLoc: LocationNode,
    isOutgoingFromPortal: boolean
  ) => {
    if (!currentContainerId) return;
    const destContName =
      extLoc.container_id && byId.has(extLoc.container_id)
        ? byId.get(extLoc.container_id)!.name
        : "World Root";
    let ghostEntry = ghostMap.get(extLoc.id);
    if (!ghostEntry) {
      ghostEntry = {
        destination: extLoc,
        destinationContainerName: destContName,
        connectedPortalIds: [],
      };
      ghostMap.set(extLoc.id, ghostEntry);
    }
    if (!ghostEntry.connectedPortalIds.includes(portalLocId)) {
      ghostEntry.connectedPortalIds.push(portalLocId);
    }
    ghostEdges.push({
      id: `ghost:${edge.id}`,
      portalLocationId: portalLocId,
      externalLocationId: extLoc.id,
      sourceNodeId: isOutgoingFromPortal ? portalLocId : extLoc.id,
      targetNodeId: isOutgoingFromPortal ? extLoc.id : portalLocId,
      direction_label: edge.direction_label,
      compass_direction: edge.compass_direction,
      distance_meters: edge.distance_meters,
      speed_modifier: edge.speed_modifier ?? 1,
      travel_mode: edge.travel_mode ?? null,
      obstacles: edge.obstacles ?? [],
      is_blocked: Boolean(edge.is_blocked),
      is_secret: Boolean(edge.is_secret),
      isUndiscoveredSecret: isUndiscoveredSecretEdge(edge),
      rawEdge: edge,
    });
  };

  for (const edge of visibleInputEdges) {
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
          registerGhostLink(edge, edge.from_location_id, dest, true);
        }
      }
      continue;
    }

    if (!fromVis && toVis) {
      if (toVis.kind === "location") {
        const src = locMap.get(edge.from_location_id);
        if (src) {
          registerGhostLink(edge, edge.to_location_id, src, false);
        }
      }
      continue;
    }

    if (!fromVis || !toVis) continue;
    if (fromVis.id === toVis.id) continue;

    if (fromVis.kind === "location" && toVis.kind === "location") {
      const undisc = isUndiscoveredSecretEdge(edge);
      projectedEdges.push({
        id: edge.id,
        sourceNodeId: fromVis.id,
        targetNodeId: toVis.id,
        direction_label: edge.direction_label,
        compass_direction: edge.compass_direction,
        distance_meters: edge.distance_meters,
        speed_modifier: edge.speed_modifier ?? 1,
        travel_mode: edge.travel_mode ?? null,
        obstacles: edge.obstacles ?? [],
        is_blocked: Boolean(edge.is_blocked),
        is_secret: Boolean(edge.is_secret),
        isUndiscoveredSecret: undisc,
        isAggregated: false,
        containsBlockedEdge: Boolean(edge.is_blocked),
        containsUndiscoveredSecretEdge: undisc,
        containsObstacles: (edge.obstacles?.length ?? 0) > 0,
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
    const minMeters = Math.min(...group.edges.map((e) => e.distance_meters));
    const anyBlocked = group.edges.some((e) => e.is_blocked);
    const anySecret = group.edges.some((e) => e.is_secret);
    const anyUndiscSecret = group.edges.some((e) => isUndiscoveredSecretEdge(e));
    const anyObstacles = group.edges.some((e) => (e.obstacles?.length ?? 0) > 0);
    projectedEdges.push({
      id: `agg:${groupKey}`,
      sourceNodeId: group.sourceNodeId,
      targetNodeId: group.targetNodeId,
      direction_label:
        group.edges.length > 1
          ? `${group.edges.length} passages`
          : first.direction_label,
      compass_direction: first.compass_direction,
      distance_meters: minMeters,
      speed_modifier: first.speed_modifier ?? 1,
      travel_mode: first.travel_mode ?? null,
      obstacles: first.obstacles ?? [],
      is_blocked: anyBlocked,
      is_secret: anySecret,
      isUndiscoveredSecret: anyUndiscSecret,
      isAggregated: true,
      containsBlockedEdge: anyBlocked,
      containsUndiscoveredSecretEdge: anyUndiscSecret,
      containsObstacles: anyObstacles,
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
    ghostExternalNodes: Array.from(ghostMap.values()),
    ghostEdges,
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
  explicitTargetSlot?: CompassDirection;
  distanceMeters: number;
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

export function cloneGhostCoords(
  raw?: Record<string, { x: number; y: number }> | null
): Record<string, { x: number; y: number }> | undefined {
  if (!raw) return undefined;
  const entries = Object.entries(raw);
  if (entries.length === 0) return {};
  const out: Record<string, { x: number; y: number }> = {};
  for (const [k, v] of entries) {
    if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) {
      out[k] = { x: v.x, y: v.y };
    }
  }
  return out;
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
      ghost_coords: cloneGhostCoords(c.ghost_coords),
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
    edges: edges.map((e) => ({
      ...e,
      obstacles: [...(e.obstacles ?? [])],
    })),
  };
}

function areGhostCoordsEqual(
  a?: Record<string, { x: number; y: number }> | null,
  b?: Record<string, { x: number; y: number }> | null
): boolean {
  const aKeys = Object.keys(a ?? {});
  const bKeys = Object.keys(b ?? {});
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    const av = a?.[k];
    const bv = b?.[k];
    if (!av || !bv || av.x !== bv.x || av.y !== bv.y) return false;
  }
  return true;
}

export function areGraphSnapshotsEqual(a: GraphSnapshot, b: GraphSnapshot): boolean {
  if (
    a.containers.length !== b.containers.length ||
    a.locations.length !== b.locations.length ||
    a.edges.length !== b.edges.length
  ) {
    return false;
  }
  const sortById = <T extends { id: string }>(arr: T[]): T[] =>
    [...arr].sort((x, y) => x.id.localeCompare(y.id));

  const ac = sortById(a.containers);
  const bc = sortById(b.containers);
  for (let i = 0; i < ac.length; i++) {
    const x = ac[i];
    const y = bc[i];
    if (
      x.id !== y.id ||
      (x.parent_container_id ?? null) !== (y.parent_container_id ?? null) ||
      x.depth !== y.depth ||
      x.name !== y.name ||
      x.description !== y.description ||
      (x.ui_x ?? null) !== (y.ui_x ?? null) ||
      (x.ui_y ?? null) !== (y.ui_y ?? null) ||
      (x.icon ?? null) !== (y.icon ?? null) ||
      !areGhostCoordsEqual(x.ghost_coords, y.ghost_coords) ||
      JSON.stringify(x.environmental_tags ?? []) !== JSON.stringify(y.environmental_tags ?? []) ||
      JSON.stringify(x.lore_nodes ?? []) !== JSON.stringify(y.lore_nodes ?? [])
    ) {
      return false;
    }
  }

  const al = sortById(a.locations);
  const bl = sortById(b.locations);
  for (let i = 0; i < al.length; i++) {
    const x = al[i];
    const y = bl[i];
    if (
      x.id !== y.id ||
      (x.container_id ?? null) !== (y.container_id ?? null) ||
      Boolean(x.is_entry_exit) !== Boolean(y.is_entry_exit) ||
      Boolean(x.is_starting_location) !== Boolean(y.is_starting_location) ||
      Boolean(x.is_hub) !== Boolean(y.is_hub) ||
      x.name !== y.name ||
      x.summary !== y.summary ||
      x.description !== y.description ||
      (x.starting_message ?? "") !== (y.starting_message ?? "") ||
      (x.ui_x ?? null) !== (y.ui_x ?? null) ||
      (x.ui_y ?? null) !== (y.ui_y ?? null) ||
      (x.icon ?? null) !== (y.icon ?? null) ||
      JSON.stringify(x.environmental_tags ?? []) !== JSON.stringify(y.environmental_tags ?? []) ||
      JSON.stringify(x.lore_nodes ?? []) !== JSON.stringify(y.lore_nodes ?? [])
    ) {
      return false;
    }
  }

  const ae = sortById(a.edges);
  const be = sortById(b.edges);
  for (let i = 0; i < ae.length; i++) {
    const x = ae[i];
    const y = be[i];
    if (
      x.id !== y.id ||
      x.from_location_id !== y.from_location_id ||
      x.to_location_id !== y.to_location_id ||
      x.direction_label !== y.direction_label ||
      (x.compass_direction ?? null) !== (y.compass_direction ?? null) ||
      x.distance_meters !== y.distance_meters ||
      (x.speed_modifier ?? 1) !== (y.speed_modifier ?? 1) ||
      (x.travel_mode ?? null) !== (y.travel_mode ?? null) ||
      Boolean(x.is_blocked) !== Boolean(y.is_blocked) ||
      Boolean(x.is_secret) !== Boolean(y.is_secret) ||
      JSON.stringify(x.obstacles ?? []) !== JSON.stringify(y.obstacles ?? [])
    ) {
      return false;
    }
  }

  return true;
}

export function clientToWorldPoint(
  clientX: number,
  clientY: number,
  svgEl: SVGSVGElement | null,
  groupEl: SVGGElement | null,
  pan: { x: number; y: number },
  zoom: number,
  viewBox: { width: number; height: number } = { width: 680, height: 520 }
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
  const scale = Math.min(rect.width / viewBox.width, rect.height / viewBox.height) || 1;
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
  _groupEl: SVGGElement | null,
  pan: { x: number; y: number },
  zoom: number,
  viewBox: { width: number; height: number } = { width: 680, height: 520 }
): { x: number; y: number } | null {
  if (!svgEl || !wrapEl) return null;
  const wrapRect = wrapEl.getBoundingClientRect();
  if (wrapRect.width <= 0 || wrapRect.height <= 0) return null;
  const originLeft = wrapRect.left + (wrapEl.clientLeft || 0);
  const originTop = wrapRect.top + (wrapEl.clientTop || 0);

  const vbX = (worldX + pan.x) * zoom;
  const vbY = (worldY + pan.y) * zoom;

  if (
    typeof svgEl.createSVGPoint === "function" &&
    typeof svgEl.getScreenCTM === "function"
  ) {
    const ctm = svgEl.getScreenCTM();
    if (ctm) {
      const pt = svgEl.createSVGPoint();
      pt.x = vbX;
      pt.y = vbY;
      const screenPt = pt.matrixTransform(ctm);
      return {
        x: screenPt.x - originLeft,
        y: screenPt.y - originTop,
      };
    }
  }

  const svgRect = svgEl.getBoundingClientRect();
  if (svgRect.width <= 0 || svgRect.height <= 0) return null;
  const scale = Math.min(svgRect.width / viewBox.width, svgRect.height / viewBox.height) || 1;
  return {
    x: svgRect.left + svgRect.width / 2 + vbX * scale - originLeft,
    y: svgRect.top + svgRect.height / 2 + vbY * scale - originTop,
  };
}

export function makeUniqueId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function resolveLiveEdgeModalEdges(
  modalEdges: LocationEdge[] | null,
  workingEdges: LocationEdge[]
): LocationEdge[] | null {
  if (!modalEdges || modalEdges.length === 0) return null;
  const byId = new Map(workingEdges.map((edge) => [edge.id, edge]));
  const resolved = modalEdges
    .map((edge) => byId.get(edge.id))
    .filter((edge): edge is LocationEdge => Boolean(edge));
  return resolved.length > 0 ? resolved : null;
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

const AUTO_EDGE_LABEL_PREFIXES = [
  "Passage to ",
  "Return to ",
  "Return passage to ",
  "Back to ",
  "To ",
] as const;

/**
 * Sync auto-generated template `direction_label` values on incoming edges when
 * a location is renamed or converted, leaving custom labels untouched.
 */
export function syncEdgeLabelsForLocationRename(
  edges: LocationEdge[],
  locationId: string,
  oldName: string,
  newName: string
): LocationEdge[] {
  const oldTrimmed = oldName.trim();
  const newTrimmed = newName.trim();
  if (!oldTrimmed || !newTrimmed || oldTrimmed === newTrimmed) {
    return edges;
  }
  const oldLower = oldTrimmed.toLowerCase();
  let changed = false;
  const next = edges.map((edge) => {
    if (edge.to_location_id !== locationId) return edge;
    const rawTrimmed = edge.direction_label.trim();
    const rawLower = rawTrimmed.toLowerCase();
    for (const prefix of AUTO_EDGE_LABEL_PREFIXES) {
      const expected = `${prefix.toLowerCase()}${oldLower}`;
      if (rawLower === expected) {
        changed = true;
        return {
          ...edge,
          direction_label: `${prefix}${newTrimmed}`,
        };
      }
    }
    return edge;
  });
  return changed ? next : edges;
}

export interface BidirectionalProjectedBundle {
  allEdges: LocationEdge[];
  passagePairCount: number;
  minDistanceMeters: number;
  maxDistanceMeters: number;
  containsBlockedEdge: boolean;
  containsUndiscoveredSecretEdge: boolean;
  containsObstacles: boolean;
}

/**
 * Merge forward and reverse projected edges between two endpoints so collapsed
 * supernode badges, tooltips, and inspector bundles reflect both directions uniformly.
 */
export function resolveBidirectionalProjectedBundle(
  edge: Pick<
    ProjectedTopologyEdge,
    | "sourceNodeId"
    | "targetNodeId"
    | "rawEdge"
    | "groupedEdges"
    | "distance_meters"
    | "containsBlockedEdge"
    | "containsUndiscoveredSecretEdge"
    | "containsObstacles"
  >,
  projectedEdges: ProjectedTopologyEdge[]
): BidirectionalProjectedBundle {
  const collected = new Map<string, LocationEdge>();
  const addEdge = (item: LocationEdge) => {
    if (!collected.has(item.id)) {
      collected.set(item.id, item);
    }
  };

  let containsUndiscoveredSecretEdge = edge.containsUndiscoveredSecretEdge;
  for (const ge of edge.groupedEdges ?? [edge.rawEdge]) {
    addEdge(ge);
  }
  for (const candidate of projectedEdges) {
    const isSamePair =
      (candidate.sourceNodeId === edge.sourceNodeId &&
        candidate.targetNodeId === edge.targetNodeId) ||
      (candidate.sourceNodeId === edge.targetNodeId &&
        candidate.targetNodeId === edge.sourceNodeId);
    if (!isSamePair) continue;
    if (candidate.containsUndiscoveredSecretEdge) {
      containsUndiscoveredSecretEdge = true;
    }
    for (const ge of candidate.groupedEdges ?? [candidate.rawEdge]) {
      addEdge(ge);
    }
  }

  const allEdges = Array.from(collected.values()).sort((a, b) => {
    if (a.from_location_id !== b.from_location_id) {
      return a.from_location_id.localeCompare(b.from_location_id);
    }
    if (a.to_location_id !== b.to_location_id) {
      return a.to_location_id.localeCompare(b.to_location_id);
    }
    return a.id.localeCompare(b.id);
  });

  const pairKeys = new Set<string>();
  let minDistanceMeters = edge.distance_meters;
  let maxDistanceMeters = edge.distance_meters;
  let containsBlockedEdge = edge.containsBlockedEdge;
  let containsObstacles = edge.containsObstacles;
  if (allEdges.length > 0) {
    minDistanceMeters = Infinity;
    maxDistanceMeters = 0;
    containsBlockedEdge = false;
    containsObstacles = false;
    for (const item of allEdges) {
      pairKeys.add([item.from_location_id, item.to_location_id].sort().join("<->"));
      if (item.distance_meters < minDistanceMeters) {
        minDistanceMeters = item.distance_meters;
      }
      if (item.distance_meters > maxDistanceMeters) {
        maxDistanceMeters = item.distance_meters;
      }
      if (item.is_blocked) {
        containsBlockedEdge = true;
      }
      if ((item.obstacles?.length ?? 0) > 0) {
        containsObstacles = true;
      }
    }
  }

  return {
    allEdges,
    passagePairCount: pairKeys.size || 1,
    minDistanceMeters: Number.isFinite(minDistanceMeters)
      ? minDistanceMeters
      : edge.distance_meters,
    maxDistanceMeters:
      maxDistanceMeters > 0 ? maxDistanceMeters : edge.distance_meters,
    containsBlockedEdge,
    containsUndiscoveredSecretEdge,
    containsObstacles,
  };
}

/** Resolve a directed edge and its optional reciprocal peer for Link Pair inspection. */
export function resolveLinkPairForInspector(
  edgeId: string,
  workingEdges: readonly LocationEdge[]
): LinkPairInspectorData | null {
  const primary = workingEdges.find((e) => e.id === edgeId);
  if (!primary) return null;
  const reciprocal =
    workingEdges.find(
      (e) =>
        e.id !== primary.id &&
        e.from_location_id === primary.to_location_id &&
        e.to_location_id === primary.from_location_id
    ) ?? null;
  return {
    pairKey: canonicalEdgePairKey(primary.from_location_id, primary.to_location_id),
    primary,
    reciprocal,
  };
}

/** Group a list of edge IDs (e.g. a collapsed supernode bundle) into unique Link Pairs. */
export function resolveBundleLinkPairs(
  edgeIds: readonly string[],
  workingEdges: readonly LocationEdge[]
): LinkPairInspectorData[] {
  const idSet = new Set(edgeIds);
  const seenPairs = new Set<string>();
  const pairs: LinkPairInspectorData[] = [];
  for (const edge of workingEdges) {
    if (!idSet.has(edge.id)) continue;
    const key = canonicalEdgePairKey(edge.from_location_id, edge.to_location_id);
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    const resolved = resolveLinkPairForInspector(edge.id, workingEdges);
    if (resolved) {
      pairs.push(resolved);
    }
  }
  return pairs;
}

/**
 * Resolve the list of directed edges for an edge ID (plus its reciprocal edge,
 * or an explicit bundle of edge IDs).
 */
export function resolveEdgePairForDialog(
  edgeId: string,
  workingEdges: LocationEdge[],
  groupedEdgeIds?: string[]
): LocationEdge[] {
  if (groupedEdgeIds && groupedEdgeIds.length > 0) {
    const idSet = new Set(groupedEdgeIds);
    const matched = workingEdges.filter((e) => idSet.has(e.id));
    if (matched.length > 0) return matched;
  }
  const target = workingEdges.find((e) => e.id === edgeId);
  if (!target) return [];
  const reciprocal = workingEdges.filter(
    (e) =>
      e.id !== target.id &&
      e.from_location_id === target.to_location_id &&
      e.to_location_id === target.from_location_id
  );
  return [target, ...reciprocal];
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

interface OccupiedFootprintBox {
  x: number;
  y: number;
  halfW: number;
  halfH: number;
}

const DEFAULT_VISIBLE_FOOTPRINT = { halfW: 54, halfH: 34 };
const GHOST_FOOTPRINT = { halfW: 68, halfH: 23 };
const GHOST_BOX_PAD = 14;

function computeBoxOverlapArea(
  ax: number,
  ay: number,
  aHalfW: number,
  aHalfH: number,
  b: OccupiedFootprintBox,
  pad: number = GHOST_BOX_PAD
): number {
  const ox = aHalfW + b.halfW + pad - Math.abs(ax - b.x);
  if (ox <= 0) return 0;
  const oy = aHalfH + b.halfH + pad - Math.abs(ay - b.y);
  if (oy <= 0) return 0;
  return ox * oy;
}

/**
 * Compute per-view coordinates for external ghost nodes using directional
 * projection from connected portals (or saved per-container overrides),
 * using box-aware ring/angle search so cramped layouts stay overlap-free
 * and pinned ghost nodes never bounce when visible nodes move.
 */
export function computeGhostNodeCoords(
  ghostNodes: ProjectedGhostExternalNode[],
  ghostEdges: ProjectedGhostEdge[],
  visibleCoords: Record<string, { x: number; y: number }>,
  overrides?: Record<string, { x: number; y: number }>,
  visibleFootprints?: Record<string, { halfW: number; halfH: number }>
): Record<string, { x: number; y: number }> {
  const result: Record<string, { x: number; y: number }> = {};
  if (ghostNodes.length === 0) return result;

  const occupiedBoxes: OccupiedFootprintBox[] = Object.entries(visibleCoords).map(
    ([id, pt]) => {
      const fp = visibleFootprints?.[id] ?? DEFAULT_VISIBLE_FOOTPRINT;
      return { x: pt.x, y: pt.y, halfW: fp.halfW, halfH: fp.halfH };
    }
  );

  // Pass 1: Lock all saved/pinned ghost overrides first so they never move or
  // cause unpinned ghosts to collide with them.
  const unpinned: Array<{ ghost: ProjectedGhostExternalNode; index: number }> = [];
  for (let gIdx = 0; gIdx < ghostNodes.length; gIdx++) {
    const ghost = ghostNodes[gIdx];
    const extId = ghost.destination.id;
    const override = overrides?.[extId];
    if (
      override &&
      typeof override.x === "number" &&
      Number.isFinite(override.x) &&
      typeof override.y === "number" &&
      Number.isFinite(override.y)
    ) {
      const pinned = { x: Math.round(override.x), y: Math.round(override.y) };
      result[extId] = pinned;
      occupiedBoxes.push({
        x: pinned.x,
        y: pinned.y,
        halfW: GHOST_FOOTPRINT.halfW,
        halfH: GHOST_FOOTPRINT.halfH,
      });
    } else {
      unpinned.push({ ghost, index: gIdx });
    }
  }

  // Pass 2: Place remaining auto-placed ghosts on a box-aware outer ring /
  // angular sweep around their portal anchor.
  const preferredOffsetDist = 210;
  const candidateRadii = [210, 275, 160, 340, 410];
  const candidateAnglesDeg = [
    0, 18, -18, 36, -36, 54, -54, 72, -72, 90, -90, 115, -115, 145, -145, 180,
  ];
  const candidateOffsets: Array<{ radius: number; deg: number; score: number }> = [];
  for (const radius of candidateRadii) {
    for (const deg of candidateAnglesDeg) {
      candidateOffsets.push({
        radius,
        deg,
        score: Math.abs(deg) * 2.4 + Math.abs(radius - preferredOffsetDist) * 0.45,
      });
    }
  }
  candidateOffsets.sort((a, b) => a.score - b.score);

  for (const { ghost, index: gIdx } of unpinned) {
    const extId = ghost.destination.id;
    const attachedEdges = ghostEdges.filter(
      (ge) => ge.externalLocationId === extId
    );
    const portalAnchors: Array<{ x: number; y: number; vx: number; vy: number }> = [];
    const seenPortal = new Set<string>();

    for (const ge of attachedEdges) {
      if (seenPortal.has(ge.portalLocationId)) continue;
      const pPt = visibleCoords[ge.portalLocationId];
      if (!pPt) continue;
      seenPortal.add(ge.portalLocationId);
      const rawDir =
        ge.compass_direction && COMPASS_ORDER.includes(ge.compass_direction)
          ? ge.compass_direction
          : inferCompassDirection(null, ge.direction_label);
      const outwardDir =
        ge.sourceNodeId === ge.portalLocationId
          ? rawDir
          : OPPOSITE_COMPASS[rawDir];
      const angle = COMPASS_ANGLES[outwardDir];
      portalAnchors.push({
        x: pPt.x,
        y: pPt.y,
        vx: Math.cos(angle),
        vy: Math.sin(angle),
      });
    }

    let anchorX = 0;
    let anchorY = 0;
    let baseAngle = -Math.PI / 4 + gIdx * (Math.PI / 3);
    if (portalAnchors.length > 0) {
      let sumVx = 0;
      let sumVy = 0;
      for (const pa of portalAnchors) {
        anchorX += pa.x;
        anchorY += pa.y;
        sumVx += pa.vx;
        sumVy += pa.vy;
      }
      anchorX /= portalAnchors.length;
      anchorY /= portalAnchors.length;
      if (Math.hypot(sumVx, sumVy) > 1e-4) {
        baseAngle = Math.atan2(sumVy, sumVx);
      }
    }

    let gx = anchorX + Math.cos(baseAngle) * preferredOffsetDist;
    let gy = anchorY + Math.sin(baseAngle) * preferredOffsetDist;
    let bestOverlap = Infinity;
    let foundClean = false;

    for (const cand of candidateOffsets) {
      const angle = baseAngle + (cand.deg * Math.PI) / 180;
      const cx = anchorX + Math.cos(angle) * cand.radius;
      const cy = anchorY + Math.sin(angle) * cand.radius;
      let overlapSum = 0;
      for (const box of occupiedBoxes) {
        overlapSum += computeBoxOverlapArea(
          cx,
          cy,
          GHOST_FOOTPRINT.halfW,
          GHOST_FOOTPRINT.halfH,
          box
        );
      }
      if (overlapSum === 0) {
        gx = cx;
        gy = cy;
        foundClean = true;
        break;
      }
      if (overlapSum < bestOverlap) {
        bestOverlap = overlapSum;
        gx = cx;
        gy = cy;
      }
    }

    // Fallback AABB separation pass if every candidate ring was saturated
    if (!foundClean) {
      for (let step = 0; step < 16; step++) {
        let moved = false;
        for (const box of occupiedBoxes) {
          const dx = gx - box.x;
          const dy = gy - box.y;
          const reqX = GHOST_FOOTPRINT.halfW + box.halfW + GHOST_BOX_PAD;
          const reqY = GHOST_FOOTPRINT.halfH + box.halfH + GHOST_BOX_PAD;
          const ox = reqX - Math.abs(dx);
          const oy = reqY - Math.abs(dy);
          if (ox > 0 && oy > 0) {
            moved = true;
            if (ox < oy) {
              gx += (dx >= 0 ? 1 : -1) * (ox + 6);
            } else {
              gy += (dy >= 0 ? 1 : -1) * (oy + 6);
            }
          }
        }
        if (!moved) break;
      }
    }

    result[extId] = { x: Math.round(gx), y: Math.round(gy) };
    occupiedBoxes.push({
      x: result[extId].x,
      y: result[extId].y,
      halfW: GHOST_FOOTPRINT.halfW,
      halfH: GHOST_FOOTPRINT.halfH,
    });
  }

  return result;
}
