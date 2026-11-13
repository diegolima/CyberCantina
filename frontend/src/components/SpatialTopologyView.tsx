import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronRight,
  Compass,
  Crosshair,
  DoorOpen,
  FolderOpen,
  GitBranch,
  Layers,
  Save,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  CompassDirection,
  LocationContainer,
  LocationEdge,
  LocationLoreNodeDraft,
  LocationNode,
} from "../types";
import {
  MapDetailsDrawer,
  WorldPromptContext,
} from "./map/MapDetailsDrawer";
import {
  EmptyCanvasCreateModal,
  EmptyCanvasLinkState,
  GroupIntoContainerModal,
  GroupIntoContainerState,
  MapContextMenu,
  MapContextMenuState,
  MultiEdgePopover,
  PassageHubCollisionModal,
  PassageHubCollisionState,
} from "./map/MapDialogs";
import { getDefaultMapIconKey, resolveMapIconComponent } from "./map/mapIcons";
import {
  MapPaletteBar,
  PALETTE_DRAG_MIME,
  PaletteItemKind,
} from "./map/MapPaletteBar";
import {
  computeUnreachableLocationIds,
  containerHasVisitedDescendants,
  getDescendantContainerIds,
  isValidContainerDrop,
  validateContainersState,
  validateVisitedAncestorContainment,
} from "./map/mapValidation";

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

function compassFromVector(dx: number, dy: number): CompassDirection {
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
  targetContainerForRoomPick: LocationContainer | null;
  targetRoomCandidates: LocationNode[];
  chosenTargetRoomId: string;
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

interface GraphSnapshot {
  containers: LocationContainer[];
  locations: LocationNode[];
  edges: LocationEdge[];
}

function cloneGraph(
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

function clientToWorldPoint(
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

function makeUniqueId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export interface SpatialTopologyViewProps {
  title?: string;
  containers?: LocationContainer[];
  locations: LocationNode[];
  edges: LocationEdge[];
  activeLocationId: string;
  defaultSelectedLocationId?: string | null;
  presentCharacterLocations?: Record<string, string>;
  mode: "campaign" | "editor";
  worldContext?: WorldPromptContext;
  hasUnsavedChanges?: boolean;
  isSavingMap?: boolean;
  onSaveMap?: (graph: GraphSnapshot) => Promise<void> | void;
  onChangeGraph?: (next: GraphSnapshot) => void;
  onClose?: () => void;
  onReimagineMap?: () => void;
  onOverrideLocation?: (locationId: string) => Promise<void> | void;
  isOverriding?: boolean;
  onSaveCampaignLocationLore?: (
    locationId: string,
    loreNodes: LocationLoreNodeDraft[]
  ) => Promise<void> | void;
  onSaveCampaignContainerLore?: (
    containerId: string,
    loreNodes: LocationLoreNodeDraft[]
  ) => Promise<void> | void;
  isMutatingLocked?: boolean;
}

export const SpatialTopologyView: React.FC<SpatialTopologyViewProps> = ({
  title,
  containers: propContainers = [],
  locations: propLocations,
  edges: propEdges,
  activeLocationId,
  defaultSelectedLocationId,
  presentCharacterLocations,
  mode,
  worldContext,
  hasUnsavedChanges: externalDirty,
  isSavingMap: externalSaving = false,
  onSaveMap,
  onChangeGraph,
  onClose,
  onReimagineMap,
  onOverrideLocation,
  isOverriding = false,
  onSaveCampaignLocationLore,
  onSaveCampaignContainerLore,
  isMutatingLocked = false,
}) => {
  // Staged draft state for async editing in campaign (or standalone editor without onChangeGraph)
  const isControlledExternally = mode === "editor" && Boolean(onChangeGraph);
  const [draft, setDraft] = useState<GraphSnapshot>(() =>
    cloneGraph(propContainers, propLocations, propEdges)
  );
  const [internalDirty, setInternalDirty] = useState(false);
  const [internalSaving, setInternalSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<GraphSnapshot[]>([]);

  const baselineContainerIds = useMemo(
    () => new Set(propContainers.map((c) => c.id)),
    [propContainers]
  );
  const baselineLocationIds = useMemo(
    () => new Set(propLocations.map((l) => l.id)),
    [propLocations]
  );

  // Keep draft synced when props update and no local staged changes are pending
  useEffect(() => {
    if (!isControlledExternally && !internalDirty) {
      setDraft(cloneGraph(propContainers, propLocations, propEdges));
      setSaveError(null);
    }
  }, [isControlledExternally, internalDirty, propContainers, propLocations, propEdges]);

  const workingContainers = isControlledExternally
    ? propContainers
    : draft.containers;
  const workingLocations = isControlledExternally
    ? propLocations
    : draft.locations;
  const workingEdges = isControlledExternally ? propEdges : draft.edges;
  const worldId =
    worldContext?.worldId ||
    workingLocations[0]?.world_id ||
    workingContainers[0]?.world_id ||
    "world_draft";

  const effectiveDirty = isControlledExternally
    ? Boolean(externalDirty)
    : internalDirty;
  const effectiveSaving = externalSaving || internalSaving;

  const commitNextGraph = useCallback(
    (next: GraphSnapshot, pushUndo = true) => {
      if (pushUndo) {
        const snapshotBefore = cloneGraph(
          workingContainers,
          workingLocations,
          workingEdges
        );
        setUndoStack((prev) => [...prev.slice(-19), snapshotBefore]);
      }
      setSaveError(null);
      if (isControlledExternally && onChangeGraph) {
        onChangeGraph(next);
      } else {
        setDraft(next);
        setInternalDirty(true);
      }
    },
    [
      isControlledExternally,
      onChangeGraph,
      workingContainers,
      workingLocations,
      workingEdges,
    ]
  );

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0 || isMutatingLocked) return;
    const prev = undoStack[undoStack.length - 1];
    const nextStack = undoStack.slice(0, -1);
    setUndoStack(nextStack);
    if (isControlledExternally && onChangeGraph) {
      onChangeGraph(prev);
    } else {
      setDraft(prev);
      setInternalDirty(nextStack.length > 0);
    }
    setStatusNotice("Reverted last map action.");
  }, [undoStack, isMutatingLocked, isControlledExternally, onChangeGraph]);

  // Selection state (null = nothing selected, hides details drawer)
  const [selectedLocId, setSelectedLocId] = useState<string | null>(() =>
    defaultSelectedLocationId === null
      ? null
      : defaultSelectedLocationId ||
        activeLocationId ||
        propLocations[0]?.id ||
        null
  );
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(
    null
  );
  const [currentContainerId, setCurrentContainerId] = useState<string | null>(
    null
  );
  const [hoveredNodeKey, setHoveredNodeKey] = useState<string | null>(null);

  // Viewport transform
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panDragRef = useRef<{
    active: boolean;
    moved: boolean;
    startClientX: number;
    startClientY: number;
    origPanX: number;
    origPanY: number;
  }>({
    active: false,
    moved: false,
    startClientX: 0,
    startClientY: 0,
    origPanX: 0,
    origPanY: 0,
  });

  // Active drag state for nodes & containers
  const [nodeDrag, setNodeDrag] = useState<{
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
  } | null>(null);

  // Active compass link-port drag
  const [linkDrag, setLinkDrag] = useState<{
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
  } | null>(null);

  // Modals & Popovers
  const [contextMenu, setContextMenu] = useState<MapContextMenuState | null>(null);
  const [hubCollisionModal, setHubCollisionModal] =
    useState<PassageHubCollisionState | null>(null);
  const [emptyCanvasModal, setEmptyCanvasModal] =
    useState<EmptyCanvasLinkState | null>(null);
  const [groupModal, setGroupModal] =
    useState<GroupIntoContainerState | null>(null);
  const [promotionPrompt, setPromotionPrompt] =
    useState<PromotionPromptState | null>(null);
  const [multiEdgeModalEdges, setMultiEdgeModalEdges] = useState<
    LocationEdge[] | null
  >(null);

  // Inline edge travel-minutes editor
  const [inlineEdgeEdit, setInlineEdgeEdit] = useState<{
    edgeId: string;
    midX: number;
    midY: number;
    value: string;
  } | null>(null);

  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewportGroupRef = useRef<SVGGElement | null>(null);

  // Keep container selection valid if deleted
  useEffect(() => {
    if (
      currentContainerId &&
      !workingContainers.some((c) => c.id === currentContainerId)
    ) {
      setCurrentContainerId(null);
    }
  }, [workingContainers, currentContainerId]);

  useEffect(() => {
    if (
      selectedContainerId &&
      !workingContainers.some((c) => c.id === selectedContainerId)
    ) {
      setSelectedContainerId(null);
    }
  }, [workingContainers, selectedContainerId]);

  useEffect(() => {
    if (
      selectedLocId &&
      !workingLocations.some((l) => l.id === selectedLocId)
    ) {
      setSelectedLocId(null);
    }
  }, [workingLocations, selectedLocId]);

  const activeLoc = useMemo(
    () =>
      workingLocations.find((l) => l.id === activeLocationId) ??
      workingLocations.find((l) => l.is_starting_location) ??
      workingLocations[0],
    [workingLocations, activeLocationId]
  );

  const selectedLocation = useMemo(
    () =>
      !selectedContainerId && selectedLocId
        ? workingLocations.find((l) => l.id === selectedLocId) ?? null
        : null,
    [workingLocations, selectedLocId, selectedContainerId]
  );

  const containerMap = useMemo(
    () => new Map(workingContainers.map((c) => [c.id, c])),
    [workingContainers]
  );
  const locationMap = useMemo(
    () => new Map(workingLocations.map((l) => [l.id, l])),
    [workingLocations]
  );

  const selectedContainer = useMemo(
    () =>
      selectedContainerId ? containerMap.get(selectedContainerId) ?? null : null,
    [selectedContainerId, containerMap]
  );

  const projectedTopology = useMemo(
    () =>
      projectTopologyForDepth(
        currentContainerId,
        workingContainers,
        workingLocations,
        workingEdges,
        activeLoc?.id,
        presentCharacterLocations
      ),
    [
      currentContainerId,
      workingContainers,
      workingLocations,
      workingEdges,
      activeLoc?.id,
      presentCharacterLocations,
    ]
  );

  // Global validation reports (Reachability + Container invariants)
  const reachabilityReport = useMemo(
    () => computeUnreachableLocationIds(workingLocations, workingEdges),
    [workingLocations, workingEdges]
  );
  const unreachableSet = useMemo(
    () => new Set(reachabilityReport.unreachableIds),
    [reachabilityReport.unreachableIds]
  );
  const containerValidationErrors = useMemo(
    () => validateContainersState(workingContainers, workingLocations),
    [workingContainers, workingLocations]
  );
  const hasBlockingErrors =
    Boolean(reachabilityReport.starterError) ||
    reachabilityReport.unreachableIds.length > 0 ||
    containerValidationErrors.length > 0;

  const fullMapCoords = useMemo(() => {
    const pseudoNodes: LocationNode[] = [
      ...projectedTopology.visibleLocations,
      ...projectedTopology.visibleSupernodes.map((sn) => ({
        id: sn.container.id,
        world_id: sn.container.world_id,
        name: sn.container.name,
        summary: sn.container.description,
        description: sn.container.description,
        environmental_tags: sn.container.environmental_tags,
        is_starting_location: false,
        ui_x: sn.container.ui_x ?? null,
        ui_y: sn.container.ui_y ?? null,
      })),
    ];
    const pseudoEdges: LocationEdge[] = projectedTopology.projectedEdges.map(
      (pe) => ({
        ...pe.rawEdge,
        id: pe.id,
        from_location_id: pe.sourceNodeId,
        to_location_id: pe.targetNodeId,
      })
    );
    const computed = computeFullMapCoords(
      pseudoNodes,
      pseudoEdges,
      projectedTopology.anchorNodeId
    );
    if (nodeDrag && nodeDrag.hasMoved) {
      computed[nodeDrag.id] = { x: nodeDrag.currX, y: nodeDrag.currY };
    }
    return computed;
  }, [projectedTopology, nodeDrag]);

  const activeNeighborIds = useMemo(() => {
    if (!activeLoc) return new Set<string>();
    return new Set(
      workingEdges
        .filter((e) => e.from_location_id === activeLoc.id)
        .map((e) => e.to_location_id)
    );
  }, [workingEdges, activeLoc]);

  // Map outgoing occupied compass slots per L0 location ID
  const occupiedSlotsByLocId = useMemo(() => {
    const map = new Map<string, Set<CompassDirection>>();
    for (const e of workingEdges) {
      if (!e.compass_direction) continue;
      if (!map.has(e.from_location_id)) map.set(e.from_location_id, new Set());
      map.get(e.from_location_id)!.add(e.compass_direction);
    }
    return map;
  }, [workingEdges]);

  const drillIntoContainer = useCallback((contId: string | null) => {
    setCurrentContainerId(contId);
    setSelectedContainerId(null);
    setContextMenu(null);
    setInlineEdgeEdit(null);
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }, []);

  const handleCenter = useCallback(() => {
    const targetId =
      selectedContainer?.id || selectedLocation?.id || activeLoc?.id;
    if (!targetId) {
      setPan({ x: 0, y: 0 });
      setZoom(1);
      return;
    }
    const pt = fullMapCoords[targetId] ?? { x: 0, y: 0 };
    setPan({ x: -pt.x, y: -pt.y });
    setZoom(1);
  }, [selectedContainer, selectedLocation, activeLoc, fullMapCoords]);

  const handleFocusInvalid = useCallback(() => {
    const firstId = reachabilityReport.unreachableIds[0];
    if (!firstId) return;
    const loc = locationMap.get(firstId);
    if (!loc) return;
    if ((loc.container_id ?? null) !== currentContainerId) {
      setCurrentContainerId(loc.container_id ?? null);
    }
    setSelectedContainerId(null);
    setSelectedLocId(loc.id);
  }, [reachabilityReport.unreachableIds, locationMap, currentContainerId]);

  const patchLocation = useCallback(
    (locId: string, patch: Partial<LocationNode>) => {
      const nextLocs = workingLocations.map((l) =>
        l.id === locId ? { ...l, ...patch } : l
      );
      commitNextGraph(
        {
          containers: workingContainers,
          locations: nextLocs,
          edges: workingEdges,
        },
        false
      );
    },
    [workingLocations, workingContainers, workingEdges, commitNextGraph]
  );

  const patchContainer = useCallback(
    (contId: string, patch: Partial<LocationContainer>) => {
      const nextConts = workingContainers.map((c) =>
        c.id === contId ? { ...c, ...patch } : c
      );
      commitNextGraph(
        {
          containers: nextConts,
          locations: workingLocations,
          edges: workingEdges,
        },
        false
      );
    },
    [workingContainers, workingLocations, workingEdges, commitNextGraph]
  );

  const resetCoordinates = useCallback(
    (kind: "location" | "container", id: string) => {
      if (kind === "location") {
        patchLocation(id, { ui_x: null, ui_y: null });
      } else {
        patchContainer(id, { ui_x: null, ui_y: null });
      }
    },
    [patchLocation, patchContainer]
  );

  const availableContainerDepthsHere = useMemo<Array<1 | 2 | 3 | 4>>(() => {
    if (!currentContainerId) return [1, 2, 3, 4];
    const curr = containerMap.get(currentContainerId);
    if (!curr) return [1, 2, 3, 4];
    return ([1, 2, 3, 4] as Array<1 | 2 | 3 | 4>).filter(
      (d) => d < curr.depth
    );
  }, [currentContainerId, containerMap]);

  const canAddContainerHere = availableContainerDepthsHere.length > 0;

  const createStandaloneAt = useCallback(
    (kind: PaletteItemKind, x: number, y: number) => {
      if (isMutatingLocked) return;
      if (kind === "container" && !canAddContainerHere) {
        setStatusNotice("Level 1 containers cannot hold nested containers.");
        return;
      }

      if (kind === "container") {
        const contId = makeUniqueId("new_cont");
        const portalId = makeUniqueId("new_loc");
        const depth = availableContainerDepthsHere[0] ?? 1;
        const contCount = workingContainers.length + 1;
        const newCont: LocationContainer = {
          id: contId,
          world_id: worldId,
          parent_container_id: currentContainerId,
          depth,
          name: `New Container ${contCount}`,
          description: "A newly added region or structure awaiting refinement.",
          environmental_tags: [],
          lore_nodes: [],
          ui_x: Math.round(x),
          ui_y: Math.round(y),
          icon: getDefaultMapIconKey("container", depth),
        };
        const newPortal: LocationNode = {
          id: portalId,
          world_id: worldId,
          container_id: contId,
          is_entry_exit: true,
          name: `${newCont.name} Entrance`,
          summary: "Entryway into this area.",
          description: "The main threshold connecting this area to neighboring paths.",
          environmental_tags: ["entrance"],
          is_starting_location: false,
          is_hub: false,
          is_visited: false,
          icon: getDefaultMapIconKey("location"),
        };
        commitNextGraph({
          containers: [...workingContainers, newCont],
          locations: [...workingLocations, newPortal],
          edges: workingEdges,
        });
        setSelectedContainerId(contId);
        setSelectedLocId(null);
        setStatusNotice(
          `Added unlinked container "${newCont.name}" — connect a passage to save.`
        );
        return;
      }

      const locId = makeUniqueId("new_loc");
      const isHub = kind === "hub";
      const idx = workingLocations.length + 1;
      const newLoc: LocationNode = {
        id: locId,
        world_id: worldId,
        container_id: currentContainerId,
        is_entry_exit: false,
        name: isHub ? `Junction ${idx}` : `New Location ${idx}`,
        summary: isHub ? "Connecting passage junction." : "Newly placed area.",
        description: isHub
          ? "A connecting thoroughfare branching toward adjoining rooms."
          : "A newly charted area ready for sensory details.",
        environmental_tags: isHub ? ["corridor"] : [],
        is_starting_location: false,
        is_hub: isHub,
        is_visited: false,
        ui_x: Math.round(x),
        ui_y: Math.round(y),
        icon: getDefaultMapIconKey(isHub ? "hub" : "location"),
      };
      commitNextGraph({
        containers: workingContainers,
        locations: [...workingLocations, newLoc],
        edges: workingEdges,
      });
      setSelectedContainerId(null);
      setSelectedLocId(locId);
      setStatusNotice(
        `Added unlinked "${newLoc.name}" — drag a link port to connect it before saving.`
      );
    },
    [
      isMutatingLocked,
      canAddContainerHere,
      availableContainerDepthsHere,
      workingContainers,
      workingLocations,
      workingEdges,
      worldId,
      currentContainerId,
      commitNextGraph,
    ]
  );

  // Execute direct bidirectional edge creation (applying optional L1 portal promotions)
  const executeDirectEdgeCreation = useCallback(
    (
      fromLoc: LocationNode,
      toLoc: LocationNode,
      direction: CompassDirection,
      travelMinutes: number,
      bidirectional: boolean,
      promoteIds: Set<string>,
      overrideLocations?: LocationNode[],
      overrideContainers?: LocationContainer[]
    ) => {
      const baseLocs = overrideLocations ?? workingLocations;
      const baseConts = overrideContainers ?? workingContainers;
      const nextLocs =
        promoteIds.size > 0
          ? baseLocs.map((l) =>
              promoteIds.has(l.id) ? { ...l, is_entry_exit: true } : l
            )
          : baseLocs;

      const revSlot = OPPOSITE_COMPASS[direction];
      const newEdges: LocationEdge[] = [
        {
          id: makeUniqueId("edge_fwd"),
          world_id: worldId,
          from_location_id: fromLoc.id,
          to_location_id: toLoc.id,
          direction_label: `Passage to ${toLoc.name}`,
          compass_direction: direction,
          travel_minutes: travelMinutes,
          is_locked_or_hidden: false,
        },
      ];
      if (bidirectional) {
        newEdges.push({
          id: makeUniqueId("edge_rev"),
          world_id: worldId,
          from_location_id: toLoc.id,
          to_location_id: fromLoc.id,
          direction_label: `Return to ${fromLoc.name}`,
          compass_direction: revSlot,
          travel_minutes: travelMinutes,
          is_locked_or_hidden: false,
        });
      }

      commitNextGraph({
        containers: baseConts,
        locations: nextLocs,
        edges: [...workingEdges, ...newEdges],
      });
      setPromotionPrompt(null);
    },
    [workingLocations, workingContainers, workingEdges, worldId, commitNextGraph]
  );

  // Resolve connecting a source L0 room and target visible entity (L0 or Container supernode)
  const initiateConnection = useCallback(
    (opts: {
      sourceKind: "location" | "container";
      sourceId: string;
      sourceSlot: CompassDirection;
      targetKind: "location" | "container";
      targetId: string;
      explicitTargetSlot?: CompassDirection;
    }) => {
      const resolveLocFromNode = (
        kind: "location" | "container",
        id: string
      ): { loc: LocationNode | null; container: LocationContainer | null; candidates: LocationNode[] } => {
        if (kind === "location") {
          return {
            loc: locationMap.get(id) ?? null,
            container: null,
            candidates: [],
          };
        }
        const subIds = getDescendantContainerIds(id, workingContainers);
        const inside = workingLocations.filter(
          (l) => l.container_id != null && subIds.has(l.container_id)
        );
        const portal =
          inside.find((l) => projectedTopology.dynamicPortalIds.has(l.id)) ??
          inside[0] ??
          null;
        return {
          loc: portal,
          container: containerMap.get(id) ?? null,
          candidates: inside,
        };
      };

      const srcInfo = resolveLocFromNode(opts.sourceKind, opts.sourceId);
      const tgtInfo = resolveLocFromNode(opts.targetKind, opts.targetId);
      if (!srcInfo.loc || !tgtInfo.loc) {
        setStatusNotice(
          "Cannot connect to an empty container — add a room inside it first."
        );
        return;
      }
      if (srcInfo.loc.id === tgtInfo.loc.id) return;

      // Avoid duplicate identical direct edges
      const alreadyConnected = workingEdges.some(
        (e) =>
          (e.from_location_id === srcInfo.loc!.id &&
            e.to_location_id === tgtInfo.loc!.id) ||
          (e.from_location_id === tgtInfo.loc!.id &&
            e.to_location_id === srcInfo.loc!.id)
      );
      if (alreadyConnected) {
        setStatusNotice("Those locations are already linked.");
        return;
      }

      const srcPt = fullMapCoords[opts.sourceId] ?? { x: 0, y: 0 };
      const tgtPt = fullMapCoords[opts.targetId] ?? { x: 100, y: 0 };
      const targetSlot =
        opts.explicitTargetSlot ?? OPPOSITE_COMPASS[opts.sourceSlot];

      // Check compass port collision on source or explicit target port
      const srcExistingEdge = workingEdges.find(
        (e) =>
          e.from_location_id === srcInfo.loc!.id &&
          e.compass_direction === opts.sourceSlot
      );
      const tgtExistingEdge = opts.explicitTargetSlot
        ? workingEdges.find(
            (e) =>
              e.from_location_id === tgtInfo.loc!.id &&
              e.compass_direction === opts.explicitTargetSlot
          )
        : undefined;

      if (srcExistingEdge || tgtExistingEdge) {
        const collidingSide =
          srcExistingEdge && tgtExistingEdge
            ? "both"
            : tgtExistingEdge
            ? "target"
            : "source";
        const occEdge = srcExistingEdge || tgtExistingEdge!;
        const occOther =
          locationMap.get(occEdge.to_location_id)?.name ?? "another room";
        const hubAnchor = collidingSide === "target" ? srcInfo.loc : tgtInfo.loc;
        setHubCollisionModal({
          sourceNodeId: srcInfo.loc.id,
          sourceName: srcInfo.loc.name,
          sourceSlot: opts.sourceSlot,
          targetNodeId: tgtInfo.loc.id,
          targetName: tgtInfo.loc.name,
          targetSlot,
          collidingSide,
          occupiedByName: occOther,
          suggestedHubName: `${
            collidingSide === "target" ? tgtInfo.loc.name : srcInfo.loc.name
          } — Junction`,
          travelMinutes: 2,
          x: Math.round((srcPt.x + tgtPt.x) / 2),
          y: Math.round((srcPt.y + tgtPt.y) / 2),
          // Unused variable guard: hubAnchor kept for clarity
          ...(hubAnchor ? {} : {}),
        });
        return;
      }

      // If cross-container or multi-room target container needs room pick / portal promotion
      const candidates = computePromotionCandidates(
        srcInfo.loc,
        tgtInfo.loc,
        containerMap,
        projectedTopology.dynamicPortalIds
      );
      if (
        (tgtInfo.container && tgtInfo.candidates.length > 1) ||
        candidates.length > 0
      ) {
        setPromotionPrompt({
          fromLocation: srcInfo.loc,
          toLocation: tgtInfo.loc,
          targetContainerForRoomPick:
            tgtInfo.container && tgtInfo.candidates.length > 1
              ? tgtInfo.container
              : null,
          targetRoomCandidates: tgtInfo.candidates,
          chosenTargetRoomId: tgtInfo.loc.id,
          direction: opts.sourceSlot,
          travelMinutes: 2,
          bidirectional: true,
          candidates,
        });
        return;
      }

      executeDirectEdgeCreation(
        srcInfo.loc,
        tgtInfo.loc,
        opts.sourceSlot,
        2,
        true,
        new Set()
      );
    },
    [
      locationMap,
      workingContainers,
      workingLocations,
      workingEdges,
      projectedTopology.dynamicPortalIds,
      containerMap,
      fullMapCoords,
      executeDirectEdgeCreation,
    ]
  );

  // Confirm Passage Hub insertion on colliding port
  const handleConfirmHubCollision = useCallback(
    (hubName: string, travelMinutes: number) => {
      if (!hubCollisionModal) return;
      const st = hubCollisionModal;
      const srcLoc = locationMap.get(st.sourceNodeId);
      const tgtLoc = locationMap.get(st.targetNodeId);
      if (!srcLoc || !tgtLoc) {
        setHubCollisionModal(null);
        return;
      }

      const hubAnchorContainerId =
        st.collidingSide === "target"
          ? tgtLoc.container_id ?? null
          : srcLoc.container_id ?? null;

      const hubId = makeUniqueId("new_hub");
      const hubNode: LocationNode = {
        id: hubId,
        world_id: worldId,
        container_id: hubAnchorContainerId,
        is_entry_exit: false,
        name: hubName,
        summary: "Connecting corridor junction.",
        description:
          "A multi-way transit junction linking adjoining rooms and wings.",
        environmental_tags: ["corridor", "junction"],
        is_starting_location: false,
        is_hub: true,
        is_visited: false,
        ui_x: st.x,
        ui_y: st.y,
        icon: getDefaultMapIconKey("hub"),
      };

      // Find which existing edge(s) occupied the colliding slot
      const anchorNode = st.collidingSide === "target" ? tgtLoc : srcLoc;
      const anchorSlot =
        st.collidingSide === "target" ? st.targetSlot : st.sourceSlot;
      const peerNode = st.collidingSide === "target" ? srcLoc : tgtLoc;

      const existingFwd = workingEdges.find(
        (e) =>
          e.from_location_id === anchorNode.id &&
          e.compass_direction === anchorSlot
      );

      let nextEdges = [...workingEdges];
      const hubOccupied = new Set<CompassDirection>();
      const backToAnchorSlot = OPPOSITE_COMPASS[anchorSlot];
      hubOccupied.add(backToAnchorSlot);

      if (existingFwd) {
        const oldDestId = existingFwd.to_location_id;
        const oldDest = locationMap.get(oldDestId);
        // Remove old direct edge + reverse counterpart
        nextEdges = nextEdges.filter(
          (e) =>
            e.id !== existingFwd.id &&
            !(
              e.from_location_id === oldDestId &&
              e.to_location_id === anchorNode.id
            )
        );
        // Link Anchor <-> Hub on anchorSlot
        nextEdges.push(
          {
            id: makeUniqueId("edge_hub_in"),
            world_id: worldId,
            from_location_id: anchorNode.id,
            to_location_id: hubId,
            direction_label: `To ${hubName}`,
            compass_direction: anchorSlot,
            travel_minutes: 1,
            is_locked_or_hidden: false,
          },
          {
            id: makeUniqueId("edge_hub_out"),
            world_id: worldId,
            from_location_id: hubId,
            to_location_id: anchorNode.id,
            direction_label: `Return to ${anchorNode.name}`,
            compass_direction: backToAnchorSlot,
            travel_minutes: 1,
            is_locked_or_hidden: false,
          }
        );

        // Reconnect Hub <-> oldDest
        const slotToOldDest = pickCompassSlot(anchorSlot, hubOccupied);
        hubOccupied.add(slotToOldDest);
        const origRevSlot = OPPOSITE_COMPASS[slotToOldDest];
        nextEdges.push(
          {
            id: makeUniqueId("edge_old_fwd"),
            world_id: worldId,
            from_location_id: hubId,
            to_location_id: oldDestId,
            direction_label:
              existingFwd.direction_label || `To ${oldDest?.name ?? "Wing"}`,
            compass_direction: slotToOldDest,
            travel_minutes: existingFwd.travel_minutes,
            is_locked_or_hidden: existingFwd.is_locked_or_hidden,
          },
          {
            id: makeUniqueId("edge_old_rev"),
            world_id: worldId,
            from_location_id: oldDestId,
            to_location_id: hubId,
            direction_label: `Return to ${hubName}`,
            compass_direction: origRevSlot,
            travel_minutes: existingFwd.travel_minutes,
            is_locked_or_hidden: existingFwd.is_locked_or_hidden,
          }
        );
      } else {
        nextEdges.push(
          {
            id: makeUniqueId("edge_ah"),
            world_id: worldId,
            from_location_id: anchorNode.id,
            to_location_id: hubId,
            direction_label: `To ${hubName}`,
            compass_direction: anchorSlot,
            travel_minutes: 1,
            is_locked_or_hidden: false,
          },
          {
            id: makeUniqueId("edge_ha"),
            world_id: worldId,
            from_location_id: hubId,
            to_location_id: anchorNode.id,
            direction_label: `Return to ${anchorNode.name}`,
            compass_direction: backToAnchorSlot,
            travel_minutes: 1,
            is_locked_or_hidden: false,
          }
        );
      }

      // Connect Hub <-> Peer
      const pPeer = fullMapCoords[peerNode.id] ?? { x: 0, y: 0 };
      const rawPeerDir = compassFromVector(pPeer.x - st.x, pPeer.y - st.y);
      const slotToPeer = pickCompassSlot(rawPeerDir, hubOccupied);
      hubOccupied.add(slotToPeer);
      const peerUsed = occupiedSlotsByLocId.get(peerNode.id) ?? new Set();
      const slotFromPeer = pickCompassSlot(OPPOSITE_COMPASS[slotToPeer], peerUsed);
      nextEdges.push(
        {
          id: makeUniqueId("edge_peer_fwd"),
          world_id: worldId,
          from_location_id: hubId,
          to_location_id: peerNode.id,
          direction_label: `To ${peerNode.name}`,
          compass_direction: slotToPeer,
          travel_minutes: travelMinutes,
          is_locked_or_hidden: false,
        },
        {
          id: makeUniqueId("edge_peer_rev"),
          world_id: worldId,
          from_location_id: peerNode.id,
          to_location_id: hubId,
          direction_label: `To ${hubName}`,
          compass_direction: slotFromPeer,
          travel_minutes: travelMinutes,
          is_locked_or_hidden: false,
        }
      );

      commitNextGraph({
        containers: workingContainers,
        locations: [...workingLocations, hubNode],
        edges: nextEdges,
      });
      setHubCollisionModal(null);
      setSelectedContainerId(null);
      setSelectedLocId(hubId);
      setStatusNotice(`Created Passage Hub "${hubName}" branching both paths.`);
    },
    [
      hubCollisionModal,
      locationMap,
      worldId,
      workingEdges,
      workingContainers,
      workingLocations,
      fullMapCoords,
      occupiedSlotsByLocId,
      commitNextGraph,
    ]
  );

  // Confirm creating a brand-new element connected from empty-canvas drop
  const handleConfirmEmptyCanvasCreate = useCallback(
    (opts: {
      kind: "location" | "hub" | "container";
      name: string;
      travelMinutes: number;
      containerDepth?: 1 | 2 | 3 | 4;
    }) => {
      if (!emptyCanvasModal) return;
      const st = emptyCanvasModal;

      let sourceLoc: LocationNode | undefined;
      if (st.sourceKind === "location") {
        sourceLoc = locationMap.get(st.sourceId);
      } else {
        const subIds = getDescendantContainerIds(st.sourceId, workingContainers);
        const inside = workingLocations.filter(
          (l) => l.container_id != null && subIds.has(l.container_id)
        );
        sourceLoc =
          inside.find((l) => projectedTopology.dynamicPortalIds.has(l.id)) ??
          inside[0];
      }
      if (!sourceLoc) {
        setEmptyCanvasModal(null);
        return;
      }

      if (opts.kind === "container") {
        const contId = makeUniqueId("new_cont");
        const portalId = makeUniqueId("new_loc");
        const depth = opts.containerDepth ?? 1;
        const newCont: LocationContainer = {
          id: contId,
          world_id: worldId,
          parent_container_id: currentContainerId,
          depth,
          name: opts.name,
          description: "A newly added structure.",
          environmental_tags: [],
          lore_nodes: [],
          ui_x: Math.round(st.dropX),
          ui_y: Math.round(st.dropY),
          icon: getDefaultMapIconKey("container", depth),
        };
        const portalLoc: LocationNode = {
          id: portalId,
          world_id: worldId,
          container_id: contId,
          is_entry_exit: true,
          name: `${opts.name} Entrance`,
          summary: `Entrance into ${opts.name}.`,
          description: `The gateway leading into ${opts.name}.`,
          environmental_tags: ["entrance"],
          is_starting_location: false,
          is_hub: false,
          is_visited: false,
          icon: getDefaultMapIconKey("location"),
        };
        const updatedSource =
          sourceLoc.container_id && !sourceLoc.is_entry_exit
            ? { ...sourceLoc, is_entry_exit: true }
            : sourceLoc;
        const nextLocs = workingLocations
          .map((l) => (l.id === sourceLoc!.id ? updatedSource : l))
          .concat(portalLoc);

        executeDirectEdgeCreation(
          updatedSource,
          portalLoc,
          st.sourceSlot,
          opts.travelMinutes,
          true,
          new Set(),
          nextLocs,
          [...workingContainers, newCont]
        );
        setSelectedContainerId(contId);
        setSelectedLocId(null);
        setEmptyCanvasModal(null);
        return;
      }

      const isHub = opts.kind === "hub";
      const newLocId = makeUniqueId(isHub ? "new_hub" : "new_loc");
      const newLoc: LocationNode = {
        id: newLocId,
        world_id: worldId,
        container_id: currentContainerId,
        is_entry_exit: false,
        name: opts.name,
        summary: isHub ? "Passage junction." : opts.name,
        description: isHub
          ? "A connecting corridor junction linking adjoining rooms."
          : "A newly connected room awaiting description.",
        environmental_tags: isHub ? ["corridor"] : [],
        is_starting_location: false,
        is_hub: isHub,
        is_visited: false,
        ui_x: Math.round(st.dropX),
        ui_y: Math.round(st.dropY),
        icon: getDefaultMapIconKey(isHub ? "hub" : "location"),
      };

      executeDirectEdgeCreation(
        sourceLoc,
        newLoc,
        st.sourceSlot,
        opts.travelMinutes,
        true,
        new Set(),
        [...workingLocations, newLoc],
        workingContainers
      );
      setSelectedContainerId(null);
      setSelectedLocId(newLocId);
      setEmptyCanvasModal(null);
    },
    [
      emptyCanvasModal,
      locationMap,
      workingContainers,
      workingLocations,
      projectedTopology.dynamicPortalIds,
      worldId,
      currentContainerId,
      executeDirectEdgeCreation,
    ]
  );

  // Confirm grouping L0 onto L0 into a new Level 1 container
  const handleConfirmGroupIntoContainer = useCallback(
    (containerName: string) => {
      if (!groupModal) return;
      const { draggedLoc, targetLoc, parentContainerId } = groupModal;
      const contId = makeUniqueId("new_cont");
      const targetPt = fullMapCoords[targetLoc.id] ?? { x: 0, y: 0 };
      const newCont: LocationContainer = {
        id: contId,
        world_id: worldId,
        parent_container_id: parentContainerId,
        depth: 1,
        name: containerName,
        description: `${targetLoc.name} and ${draggedLoc.name}.`,
        environmental_tags: [...(targetLoc.environmental_tags ?? [])],
        lore_nodes: [],
        ui_x: Math.round(targetPt.x),
        ui_y: Math.round(targetPt.y),
        icon: getDefaultMapIconKey("container", 1),
      };

      const nextLocs = workingLocations.map((l) => {
        if (l.id === draggedLoc.id || l.id === targetLoc.id) {
          return { ...l, container_id: contId, ui_x: null, ui_y: null };
        }
        return l;
      });
      commitNextGraph({
        containers: [...workingContainers, newCont],
        locations: nextLocs,
        edges: workingEdges,
      });
      setGroupModal(null);
      setSelectedLocId(null);
      setSelectedContainerId(contId);
      setStatusNotice(`Grouped "${draggedLoc.name}" & "${targetLoc.name}" inside "${containerName}".`);
    },
    [
      groupModal,
      fullMapCoords,
      worldId,
      workingLocations,
      workingContainers,
      workingEdges,
      commitNextGraph,
    ]
  );

  // Move element immediately onto existing container
  const executeImmediateContainerMove = useCallback(
    (
      draggedKind: "location" | "container",
      draggedId: string,
      targetContainerId: string | null
    ) => {
      if (draggedKind === "location") {
        const nextLocs = workingLocations.map((l) =>
          l.id === draggedId
            ? {
                ...l,
                container_id: targetContainerId,
                is_entry_exit: targetContainerId ? l.is_entry_exit : false,
                ui_x: null,
                ui_y: null,
              }
            : l
        );
        commitNextGraph({
          containers: workingContainers,
          locations: nextLocs,
          edges: workingEdges,
        });
      } else {
        const nextConts = workingContainers.map((c) =>
          c.id === draggedId
            ? { ...c, parent_container_id: targetContainerId, ui_x: null, ui_y: null }
            : c
        );
        commitNextGraph({
          containers: nextConts,
          locations: workingLocations,
          edges: workingEdges,
        });
      }
      const targetName = targetContainerId
        ? containerMap.get(targetContainerId)?.name ?? "container"
        : "World Root";
      setStatusNotice(`Moved into "${targetName}" (click Undo to revert).`);
    },
    [
      workingLocations,
      workingContainers,
      workingEdges,
      containerMap,
      commitNextGraph,
    ]
  );

  // Permission helpers for Context Menu & Drag validation
  const canDeleteLocation = useCallback(
    (locId: string): { allowed: boolean; reason?: string } => {
      if (workingLocations.length <= 1) {
        return { allowed: false, reason: "Map must keep at least one location." };
      }
      const loc = locationMap.get(locId);
      if (!loc) return { allowed: false };
      if (loc.is_starting_location) {
        return {
          allowed: false,
          reason: "Reassign Starting Location before deleting this room.",
        };
      }
      if (mode === "campaign" && loc.is_visited) {
        return {
          allowed: false,
          reason: "Visited campaign locations cannot be removed.",
        };
      }
      return { allowed: true };
    },
    [workingLocations.length, locationMap, mode]
  );

  const canDeleteContainer = useCallback(
    (contId: string): { allowed: boolean; reason?: string } => {
      if (mode === "campaign") {
        if (baselineContainerIds.has(contId)) {
          return {
            allowed: false,
            reason:
              "Saved containers cannot be removed mid-campaign; rewind to a turn before it existed.",
          };
        }
        if (
          containerHasVisitedDescendants(
            contId,
            workingContainers,
            workingLocations
          )
        ) {
          return {
            allowed: false,
            reason: "Containers holding visited locations cannot be removed.",
          };
        }
      }
      return { allowed: true };
    },
    [mode, baselineContainerIds, workingContainers, workingLocations]
  );

  const canConvertLocation = useCallback(
    (locId: string): { allowed: boolean; reason?: string } => {
      const loc = locationMap.get(locId);
      if (!loc) return { allowed: false };
      const parentCont = loc.container_id
        ? containerMap.get(loc.container_id)
        : undefined;
      if (parentCont && parentCont.depth <= 1) {
        return {
          allowed: false,
          reason: "Rooms inside a Level 1 container are already at the deepest container tier.",
        };
      }
      return { allowed: true };
    },
    [locationMap, containerMap]
  );

  const canMoveOutToParent = useCallback(
    (
      kind: "location" | "container",
      id: string
    ): { allowed: boolean; parentLabel: string; reason?: string } => {
      const parentContId =
        kind === "location"
          ? locationMap.get(id)?.container_id
          : containerMap.get(id)?.parent_container_id;
      const grandParentId = parentContId
        ? containerMap.get(parentContId)?.parent_container_id ?? null
        : null;
      const parentLabel = grandParentId
        ? containerMap.get(grandParentId)?.name ?? "Parent Container"
        : "World Root";

      const check = isValidContainerDrop({
        draggedKind: kind,
        draggedId: id,
        targetKind: grandParentId ? "container" : "root",
        targetId: grandParentId ?? undefined,
        currentContainerId: grandParentId,
        containers: workingContainers,
        locations: workingLocations,
        campaignMode: mode === "campaign",
        originalContainers: propContainers,
        originalLocations: propLocations,
      });
      return { allowed: check.valid, parentLabel, reason: check.reason };
    },
    [
      locationMap,
      containerMap,
      workingContainers,
      workingLocations,
      mode,
      propContainers,
      propLocations,
    ]
  );

  // Context menu action handlers
  const handleDeleteLocation = useCallback(
    (locId: string) => {
      const check = canDeleteLocation(locId);
      if (!check.allowed) {
        setStatusNotice(check.reason || "Cannot delete this location.");
        return;
      }
      const nextLocs = workingLocations.filter((l) => l.id !== locId);
      const nextEdges = workingEdges.filter(
        (e) => e.from_location_id !== locId && e.to_location_id !== locId
      );
      if (selectedLocId === locId) setSelectedLocId(null);
      commitNextGraph({
        containers: workingContainers,
        locations: nextLocs,
        edges: nextEdges,
      });
    },
    [
      canDeleteLocation,
      workingLocations,
      workingEdges,
      workingContainers,
      selectedLocId,
      commitNextGraph,
    ]
  );

  const handleDeleteContainer = useCallback(
    (contId: string) => {
      const check = canDeleteContainer(contId);
      if (!check.allowed) {
        setStatusNotice(check.reason || "Cannot remove this container.");
        return;
      }
      const target = containerMap.get(contId);
      const nextParent = target?.parent_container_id ?? null;
      const nextConts = workingContainers
        .filter((c) => c.id !== contId)
        .map((c) =>
          c.parent_container_id === contId
            ? { ...c, parent_container_id: nextParent, ui_x: null, ui_y: null }
            : c
        );
      const nextLocs = workingLocations.map((l) =>
        l.container_id === contId
          ? {
              ...l,
              container_id: nextParent,
              is_entry_exit: nextParent ? l.is_entry_exit : false,
              ui_x: null,
              ui_y: null,
            }
          : l
      );
      if (selectedContainerId === contId) setSelectedContainerId(null);
      commitNextGraph({
        containers: nextConts,
        locations: nextLocs,
        edges: workingEdges,
      });
    },
    [
      canDeleteContainer,
      containerMap,
      workingContainers,
      workingLocations,
      workingEdges,
      selectedContainerId,
      commitNextGraph,
    ]
  );

  const handleConvertLocationToContainer = useCallback(
    (locId: string) => {
      const loc = locationMap.get(locId);
      if (!loc) return;
      const check = canConvertLocation(locId);
      if (!check.allowed) {
        setStatusNotice(check.reason || "Cannot convert room.");
        return;
      }
      const keepVisitedImmutable = mode === "campaign" && Boolean(loc.is_visited);
      const contId = makeUniqueId("new_cont");
      const newCont: LocationContainer = {
        id: contId,
        world_id: worldId,
        parent_container_id: loc.container_id ?? null,
        depth: 1,
        name: loc.name,
        description: loc.description || loc.summary || "",
        environmental_tags: [...(loc.environmental_tags ?? [])],
        lore_nodes: keepVisitedImmutable
          ? []
          : (loc.lore_nodes ?? []).map((ln) => ({
              ...ln,
              location_id: null,
              container_id: contId,
            })),
        ui_x: loc.ui_x ?? null,
        ui_y: loc.ui_y ?? null,
        icon: getDefaultMapIconKey("container", 1),
      };
      const nextLocs = workingLocations.map((l) =>
        l.id === locId
          ? {
              ...l,
              container_id: contId,
              is_entry_exit: true,
              name: keepVisitedImmutable ? l.name : `${loc.name} Entrance`,
              lore_nodes: keepVisitedImmutable ? l.lore_nodes : [],
              ui_x: null,
              ui_y: null,
            }
          : l
      );
      // Verify visited containment monotonicity in campaign mode
      if (mode === "campaign" && loc.is_visited) {
        const checkCont = validateVisitedAncestorContainment(
          propLocations.find((p) => p.id === locId)?.container_id,
          propContainers,
          contId,
          [...workingContainers, newCont]
        );
        if (!checkCont.valid) {
          setStatusNotice(checkCont.reason || "Invalid containment change.");
          return;
        }
      }
      commitNextGraph({
        containers: [...workingContainers, newCont],
        locations: nextLocs,
        edges: workingEdges,
      });
      setSelectedLocId(null);
      setSelectedContainerId(contId);
    },
    [
      locationMap,
      canConvertLocation,
      worldId,
      workingLocations,
      mode,
      propLocations,
      propContainers,
      workingContainers,
      workingEdges,
      commitNextGraph,
    ]
  );

  const handleSetStartingLocation = useCallback(
    (locId: string) => {
      if (mode === "campaign") return;
      const nextLocs = workingLocations.map((l) => ({
        ...l,
        is_starting_location: l.id === locId,
      }));
      commitNextGraph({
        containers: workingContainers,
        locations: nextLocs,
        edges: workingEdges,
      });
    },
    [mode, workingLocations, workingContainers, workingEdges, commitNextGraph]
  );

  const handleUpdateEdgeDistance = useCallback(
    (edgeId: string, minutes: number) => {
      const target = workingEdges.find((e) => e.id === edgeId);
      if (!target) return;
      const clamped = Math.max(1, Math.min(240, Math.round(minutes) || 1));
      const nextEdges = workingEdges.map((e) => {
        if (
          e.id === edgeId ||
          (e.from_location_id === target.to_location_id &&
            e.to_location_id === target.from_location_id)
        ) {
          return { ...e, travel_minutes: clamped };
        }
        return e;
      });
      commitNextGraph({
        containers: workingContainers,
        locations: workingLocations,
        edges: nextEdges,
      });
    },
    [workingEdges, workingContainers, workingLocations, commitNextGraph]
  );

  const handleToggleEdgeLocked = useCallback(
    (edgeId: string) => {
      const target = workingEdges.find((e) => e.id === edgeId);
      if (!target) return;
      const nextVal = !target.is_locked_or_hidden;
      const nextEdges = workingEdges.map((e) => {
        if (
          e.id === edgeId ||
          (e.from_location_id === target.to_location_id &&
            e.to_location_id === target.from_location_id)
        ) {
          return { ...e, is_locked_or_hidden: nextVal };
        }
        return e;
      });
      commitNextGraph({
        containers: workingContainers,
        locations: workingLocations,
        edges: nextEdges,
      });
    },
    [workingEdges, workingContainers, workingLocations, commitNextGraph]
  );

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      const target = workingEdges.find((e) => e.id === edgeId);
      if (!target) return;
      const nextEdges = workingEdges.filter(
        (e) =>
          e.id !== edgeId &&
          !(
            e.from_location_id === target.to_location_id &&
            e.to_location_id === target.from_location_id
          )
      );
      commitNextGraph({
        containers: workingContainers,
        locations: workingLocations,
        edges: nextEdges,
      });
      setMultiEdgeModalEdges((prev) =>
        prev
          ? prev.filter(
              (e) =>
                e.id !== edgeId &&
                !(
                  e.from_location_id === target.to_location_id &&
                  e.to_location_id === target.from_location_id
                )
            )
          : null
      );
    },
    [workingEdges, workingContainers, workingLocations, commitNextGraph]
  );

  // Hit-testing helper in world coords
  const hitTestNodeAt = useCallback(
    (
      wx: number,
      wy: number,
      excludeKey?: { kind: "location" | "container"; id: string }
    ): { kind: "location" | "container"; id: string } | null => {
      for (const sn of projectedTopology.visibleSupernodes) {
        if (
          excludeKey?.kind === "container" &&
          excludeKey.id === sn.container.id
        ) {
          continue;
        }
        const pt = fullMapCoords[sn.container.id];
        if (!pt) continue;
        if (Math.abs(wx - pt.x) <= 76 && Math.abs(wy - pt.y) <= 28) {
          return { kind: "container", id: sn.container.id };
        }
      }
      for (const loc of projectedTopology.visibleLocations) {
        if (excludeKey?.kind === "location" && excludeKey.id === loc.id) {
          continue;
        }
        const pt = fullMapCoords[loc.id];
        if (!pt) continue;
        const radius = loc.is_hub ? 20 : 23;
        if (Math.hypot(wx - pt.x, wy - pt.y) <= radius) {
          return { kind: "location", id: loc.id };
        }
      }
      return null;
    },
    [projectedTopology, fullMapCoords]
  );

  // Hit-test compass port dots during link drag
  const hitTestPortAt = useCallback(
    (
      wx: number,
      wy: number,
      excludeKind: "location" | "container",
      excludeId: string
    ): { kind: "location" | "container"; id: string; slot?: CompassDirection } | null => {
      for (const loc of projectedTopology.visibleLocations) {
        if (excludeKind === "location" && loc.id === excludeId) continue;
        const pt = fullMapCoords[loc.id];
        if (!pt) continue;
        for (const slot of COMPASS_ORDER) {
          const a = COMPASS_ANGLES[slot];
          const px = pt.x + Math.cos(a) * 26;
          const py = pt.y + Math.sin(a) * 26;
          if (Math.hypot(wx - px, wy - py) <= 9) {
            return { kind: "location", id: loc.id, slot };
          }
        }
      }
      const bodyHit = hitTestNodeAt(wx, wy, { kind: excludeKind, id: excludeId });
      return bodyHit ? { kind: bodyHit.kind, id: bodyHit.id } : null;
    },
    [projectedTopology.visibleLocations, fullMapCoords, hitTestNodeAt]
  );

  // Global window pointer move / up listeners for nodeDrag & linkDrag
  useEffect(() => {
    if (!nodeDrag && !linkDrag) return;

    const handleMove = (ev: PointerEvent) => {
      const wpt = clientToWorldPoint(
        ev.clientX,
        ev.clientY,
        svgRef.current,
        viewportGroupRef.current,
        pan,
        zoom
      );

      if (nodeDrag) {
        const distPx = Math.hypot(
          ev.clientX - nodeDrag.startClientX,
          ev.clientY - nodeDrag.startClientY
        );
        const hasMoved = nodeDrag.hasMoved || distPx > 5;
        const currX = Math.round(wpt.x - nodeDrag.pointerOffsetX);
        const currY = Math.round(wpt.y - nodeDrag.pointerOffsetY);

        let hoverTarget: typeof nodeDrag.hoverTarget = null;
        if (hasMoved) {
          const hit = hitTestNodeAt(currX, currY, {
            kind: nodeDrag.kind,
            id: nodeDrag.id,
          });
          if (hit) {
            const check = isValidContainerDrop({
              draggedKind: nodeDrag.kind,
              draggedId: nodeDrag.id,
              targetKind: hit.kind,
              targetId: hit.id,
              currentContainerId,
              containers: workingContainers,
              locations: workingLocations,
              campaignMode: mode === "campaign",
              originalContainers: propContainers,
              originalLocations: propLocations,
            });
            hoverTarget = {
              kind: hit.kind,
              id: hit.id,
              valid: check.valid,
              reason: check.reason,
            };
          }
        }
        setNodeDrag((prev) =>
          prev ? { ...prev, currX, currY, hasMoved, hoverTarget } : null
        );
      }

      if (linkDrag) {
        const portHit = hitTestPortAt(
          wpt.x,
          wpt.y,
          linkDrag.sourceKind,
          linkDrag.sourceId
        );
        setLinkDrag((prev) =>
          prev
            ? {
                ...prev,
                currX: wpt.x,
                currY: wpt.y,
                hoverTarget: portHit,
              }
            : null
        );
      }
    };

    const handleUp = (ev: PointerEvent) => {
      if (nodeDrag) {
        if (!nodeDrag.hasMoved) {
          // Treat as Left Click -> select & inspect
          if (nodeDrag.kind === "location") {
            setSelectedContainerId(null);
            setSelectedLocId(nodeDrag.id);
          } else {
            setSelectedContainerId(nodeDrag.id);
          }
          setNodeDrag(null);
          return;
        }

        // Check if released over a breadcrumb drop zone first
        const el =
          typeof document !== "undefined"
            ? document.elementFromPoint(ev.clientX, ev.clientY)
            : null;
        const crumbEl = el?.closest?.("[data-breadcrumb-drop]");
        if (crumbEl) {
          const targetCidRaw = crumbEl.getAttribute("data-breadcrumb-drop");
          const targetCid = targetCidRaw === "__root__" ? null : targetCidRaw;
          if (targetCid !== currentContainerId) {
            const check = isValidContainerDrop({
              draggedKind: nodeDrag.kind,
              draggedId: nodeDrag.id,
              targetKind: targetCid ? "container" : "root",
              targetId: targetCid ?? undefined,
              currentContainerId: targetCid,
              containers: workingContainers,
              locations: workingLocations,
              campaignMode: mode === "campaign",
              originalContainers: propContainers,
              originalLocations: propLocations,
            });
            if (check.valid) {
              executeImmediateContainerMove(
                nodeDrag.kind,
                nodeDrag.id,
                targetCid
              );
            } else {
              setStatusNotice(check.reason || "Cannot move element out here.");
            }
            setNodeDrag(null);
            return;
          }
        }

        const ht = nodeDrag.hoverTarget;
        if (ht) {
          if (!ht.valid) {
            // Invalid drop target -> snap back cleanly
            setStatusNotice(
              ht.reason || "Invalid drop target under container depth rules."
            );
            setNodeDrag(null);
            return;
          }

          if (ht.kind === "container") {
            executeImmediateContainerMove(nodeDrag.kind, nodeDrag.id, ht.id);
            setNodeDrag(null);
            return;
          }

          // Valid L0-on-L0 drop -> open Container Name confirmation modal
          if (ht.kind === "location" && nodeDrag.kind === "location") {
            const draggedLoc = locationMap.get(nodeDrag.id);
            const targetLoc = locationMap.get(ht.id);
            if (draggedLoc && targetLoc) {
              setGroupModal({
                draggedLoc,
                targetLoc,
                parentContainerId: currentContainerId,
              });
            }
            setNodeDrag(null);
            return;
          }
        }

        // Dropped onto open canvas -> persist new coordinates
        if (nodeDrag.kind === "location") {
          patchLocation(nodeDrag.id, {
            ui_x: nodeDrag.currX,
            ui_y: nodeDrag.currY,
          });
        } else {
          patchContainer(nodeDrag.id, {
            ui_x: nodeDrag.currX,
            ui_y: nodeDrag.currY,
          });
        }
        setNodeDrag(null);
      }

      if (linkDrag) {
        const wpt = clientToWorldPoint(
          ev.clientX,
          ev.clientY,
          svgRef.current,
          viewportGroupRef.current,
          pan,
          zoom
        );
        const dropTarget = hitTestPortAt(
          wpt.x,
          wpt.y,
          linkDrag.sourceKind,
          linkDrag.sourceId
        );
        if (dropTarget) {
          initiateConnection({
            sourceKind: linkDrag.sourceKind,
            sourceId: linkDrag.sourceId,
            sourceSlot: linkDrag.sourceSlot,
            targetKind: dropTarget.kind,
            targetId: dropTarget.id,
            explicitTargetSlot: dropTarget.slot,
          });
        } else if (
          Math.hypot(linkDrag.currX - linkDrag.startX, linkDrag.currY - linkDrag.startY) >
          14
        ) {
          const srcName =
            linkDrag.sourceKind === "location"
              ? locationMap.get(linkDrag.sourceId)?.name ?? "Room"
              : containerMap.get(linkDrag.sourceId)?.name ?? "Container";
          setEmptyCanvasModal({
            sourceKind: linkDrag.sourceKind,
            sourceId: linkDrag.sourceId,
            sourceName: srcName,
            sourceSlot: linkDrag.sourceSlot,
            dropX: Math.round(wpt.x),
            dropY: Math.round(wpt.y),
            canCreateContainer: canAddContainerHere,
            availableDepths: availableContainerDepthsHere,
          });
        }
        setLinkDrag(null);
      }
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [
    nodeDrag,
    linkDrag,
    pan,
    zoom,
    hitTestNodeAt,
    hitTestPortAt,
    currentContainerId,
    workingContainers,
    workingLocations,
    mode,
    propContainers,
    propLocations,
    executeImmediateContainerMove,
    locationMap,
    containerMap,
    patchLocation,
    patchContainer,
    initiateConnection,
    canAddContainerHere,
    availableContainerDepthsHere,
  ]);

  const handleSaveClick = async () => {
    if (!onSaveMap || hasBlockingErrors || effectiveSaving) return;
    setInternalSaving(true);
    setSaveError(null);
    try {
      await onSaveMap(
        cloneGraph(workingContainers, workingLocations, workingEdges)
      );
      if (!isControlledExternally) {
        setInternalDirty(false);
        setUndoStack([]);
      }
      setStatusNotice("Map saved.");
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setInternalSaving(false);
    }
  };

  const handleCloseClick = () => {
    if (!onClose) return;
    if (
      !isControlledExternally &&
      effectiveDirty &&
      typeof window !== "undefined" &&
      !window.confirm("You have unsaved map edits. Discard changes and close?")
    ) {
      return;
    }
    onClose();
  };

  const openContextMenuAt = (
    e: React.MouseEvent,
    target: MapContextMenuState["target"]
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const wrapRect = canvasWrapRef.current?.getBoundingClientRect();
    const relX = wrapRect ? e.clientX - wrapRect.left : 24;
    const relY = wrapRect ? e.clientY - wrapRect.top : 24;
    const clampedX = wrapRect
      ? Math.max(8, Math.min(wrapRect.width - 230, relX))
      : relX;
    const clampedY = wrapRect
      ? Math.max(8, Math.min(wrapRect.height - 200, relY))
      : relY;
    setContextMenu({ x: clampedX, y: clampedY, target });
  };

  const selectedExternalPortals = useMemo(() => {
    if (!selectedLocation) return [];
    return (projectedTopology.externalPortalsByLocationId[selectedLocation.id] ?? []).map(
      (ext) => ({
        edgeId: ext.edge.id,
        destinationName: ext.destination.name,
        destinationContainerName: ext.destinationContainerName ?? "World Root",
        compassDirection: ext.edge.compass_direction,
        travelMinutes: ext.edge.travel_minutes,
        isLockedOrHidden: ext.edge.is_locked_or_hidden,
      })
    );
  }, [selectedLocation, projectedTopology.externalPortalsByLocationId]);

  const selectedContainerStats = useMemo(() => {
    if (!selectedContainer) return null;
    const stats = projectedTopology.visibleSupernodes.find(
      (s) => s.container.id === selectedContainer.id
    );
    return stats
      ? {
          descendantLocationCount: stats.descendantLocationCount,
          externalPortalsCount: stats.externalPortalsCount,
          hasActivePlayer: stats.hasActivePlayer,
        }
      : null;
  }, [selectedContainer, projectedTopology.visibleSupernodes]);

  const hasDetailsOpen = Boolean(selectedLocation || selectedContainer);

  const validationSummary =
    reachabilityReport.starterError ||
    containerValidationErrors[0] ||
    (reachabilityReport.unreachableIds.length > 0
      ? `${reachabilityReport.unreachableIds.length} unlinked location(s) cannot reach/return from Starting Location`
      : null);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        gap: 10,
        flex: 1,
        minHeight: 0,
      }}
      onClick={() => {
        if (contextMenu) setContextMenu(null);
      }}
    >
      {/* Unified Header Toolbar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: "0.88rem",
            fontWeight: 600,
          }}
        >
          <Compass size={17} color="var(--accent-cyan)" />
          {title ||
            `Spatial Topology (${workingLocations.length} Locations, ${workingEdges.length} Passages)`}
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn"
            style={{ padding: "4px 8px", fontSize: "0.74rem" }}
            onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}
            title="Zoom In"
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            className="btn"
            style={{ padding: "4px 8px", fontSize: "0.74rem" }}
            onClick={() =>
              setZoom((z) => Math.max(0.35, +(z - 0.25).toFixed(2)))
            }
            title="Zoom Out"
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            className="btn"
            style={{ padding: "4px 9px", fontSize: "0.74rem" }}
            onClick={handleCenter}
            title="Center on Selected / Active Node"
          >
            <Crosshair size={14} />
            Center ({Math.round(zoom * 100)}%)
          </button>

          {onReimagineMap && (
            <button
              type="button"
              className="btn btn-purple"
              style={{
                padding: "4px 10px",
                fontSize: "0.74rem",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
              onClick={onReimagineMap}
            >
              <Sparkles size={13} />
              Re-imagine Map
            </button>
          )}

          {onSaveMap && (
            <button
              type="button"
              className={`btn ${effectiveDirty && !hasBlockingErrors ? "btn-amber" : "btn-cyan"}`}
              disabled={
                !effectiveDirty ||
                hasBlockingErrors ||
                effectiveSaving ||
                isMutatingLocked
              }
              title={
                hasBlockingErrors
                  ? validationSummary || "Resolve unlinked nodes before saving."
                  : !effectiveDirty
                  ? "No unsaved map changes"
                  : "Persist map layout and structure"
              }
              onClick={handleSaveClick}
              style={{
                padding: "4px 12px",
                fontSize: "0.75rem",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              {effectiveSaving ? (
                <>Saving...</>
              ) : effectiveDirty ? (
                <>
                  <Save size={13} /> Save Map
                </>
              ) : (
                <>
                  <Check size={13} /> Map Saved
                </>
              )}
            </button>
          )}

          {onClose && (
            <button
              type="button"
              className="btn"
              style={{ padding: "4px 8px" }}
              onClick={handleCloseClick}
              title="Close Map"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Container Breadcrumbs (also acts as drag-drop target to move items outward) */}
      {(workingContainers.length > 0 || currentContainerId) && (
        <div
          aria-label="Container hierarchy breadcrumbs"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            flexWrap: "wrap",
            background: "var(--bg-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 6,
            padding: "5px 10px",
            fontSize: "0.75rem",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            className="btn"
            data-breadcrumb-drop="__root__"
            onClick={() => drillIntoContainer(null)}
            style={{
              padding: "2px 8px",
              fontSize: "0.72rem",
              borderColor:
                currentContainerId === null
                  ? "var(--accent-cyan)"
                  : "var(--border-subtle)",
              color:
                currentContainerId === null
                  ? "var(--accent-cyan)"
                  : "var(--text-secondary)",
            }}
          >
            World Root
          </button>

          {projectedTopology.breadcrumbs.map((crumb, idx) => {
            const isLeaf = idx === projectedTopology.breadcrumbs.length - 1;
            return (
              <React.Fragment key={crumb.id}>
                <ChevronRight size={13} color="var(--text-muted)" />
                <button
                  type="button"
                  className="btn"
                  data-breadcrumb-drop={crumb.id}
                  onClick={() => drillIntoContainer(crumb.id)}
                  style={{
                    padding: "2px 8px",
                    fontSize: "0.72rem",
                    borderColor: isLeaf
                      ? "var(--accent-amber)"
                      : "var(--border-subtle)",
                    color: isLeaf
                      ? "var(--accent-amber)"
                      : "var(--text-secondary)",
                  }}
                >
                  <FolderOpen size={11} style={{ marginRight: 4 }} />
                  {crumb.name} (L{crumb.depth})
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* Draggable Node Palette Bar + Undo + Validation Status */}
      <MapPaletteBar
        canAddContainerHere={canAddContainerHere}
        isMutatingLocked={isMutatingLocked}
        undoCount={undoStack.length}
        onUndo={handleUndo}
        onQuickAdd={(kind) => createStandaloneAt(kind, -pan.x + 55, -pan.y + 35)}
        unreachableCount={reachabilityReport.unreachableIds.length}
        validationMessage={
          reachabilityReport.starterError || containerValidationErrors[0] || null
        }
        onFocusInvalid={handleFocusInvalid}
      />

      {saveError && (
        <div
          role="alert"
          style={{
            color: "#fda4af",
            background: "rgba(244, 63, 94, 0.12)",
            border: "1px solid rgba(244, 63, 94, 0.4)",
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: "0.75rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <AlertCircle size={14} /> {saveError}
          </span>
          <button
            type="button"
            className="btn"
            style={{ padding: "1px 6px", fontSize: "0.68rem" }}
            onClick={() => setSaveError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Split Body: Canvas + Contextual Right Details Drawer */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: hasDetailsOpen
            ? "minmax(460px, 1.85fr) minmax(300px, 1fr)"
            : "1fr",
          gap: 14,
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* Left Interactive SVG Canvas Container */}
        <div
          ref={canvasWrapRef}
          style={{
            position: "relative",
            background: "var(--bg-deep)",
            borderRadius: 8,
            border: "1px solid var(--border-subtle)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(PALETTE_DRAG_MIME)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(e) => {
            const rawKind = e.dataTransfer.getData(
              PALETTE_DRAG_MIME
            ) as PaletteItemKind;
            if (!rawKind) return;
            e.preventDefault();
            const wpt = clientToWorldPoint(
              e.clientX,
              e.clientY,
              svgRef.current,
              viewportGroupRef.current,
              pan,
              zoom
            );
            createStandaloneAt(rawKind, wpt.x, wpt.y);
          }}
        >
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            viewBox="-340 -260 680 520"
            style={{
              width: "100%",
              height: "100%",
              minHeight: 0,
              cursor: nodeDrag?.hasMoved
                ? "grabbing"
                : linkDrag
                ? "crosshair"
                : panDragRef.current.active
                ? "grabbing"
                : "grab",
              display: "block",
            }}
            onWheel={(e) => {
              e.preventDefault();
              const delta = e.deltaY < 0 ? 0.15 : -0.15;
              setZoom((z) =>
                Math.min(3, Math.max(0.35, +(z + delta).toFixed(2)))
              );
            }}
            onMouseDown={(e) => {
              if (e.button !== 0 || nodeDrag || linkDrag) return;
              panDragRef.current = {
                active: true,
                moved: false,
                startClientX: e.clientX,
                startClientY: e.clientY,
                origPanX: pan.x,
                origPanY: pan.y,
              };
            }}
            onMouseMove={(e) => {
              if (!panDragRef.current.active) return;
              const rawDx = e.clientX - panDragRef.current.startClientX;
              const rawDy = e.clientY - panDragRef.current.startClientY;
              if (Math.hypot(rawDx, rawDy) > 4) {
                panDragRef.current.moved = true;
              }
              setPan({
                x: panDragRef.current.origPanX + rawDx / zoom,
                y: panDragRef.current.origPanY + rawDy / zoom,
              });
            }}
            onMouseUp={(e) => {
              if (panDragRef.current.active && !panDragRef.current.moved && e.button === 0) {
                // Click on empty canvas deselects current element & hides details pane
                setSelectedLocId(null);
                setSelectedContainerId(null);
                setContextMenu(null);
                setInlineEdgeEdit(null);
              }
              panDragRef.current.active = false;
            }}
            onMouseLeave={() => {
              panDragRef.current.active = false;
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu(null);
            }}
          >
            <g
              ref={viewportGroupRef}
              transform={`scale(${zoom}) translate(${pan.x}, ${pan.y})`}
            >
              {/* Edges & Interactive Travel Minutes Badges */}
              {projectedTopology.projectedEdges.map((edge) => {
                const p1 = fullMapCoords[edge.sourceNodeId];
                const p2 = fullMapCoords[edge.targetNodeId];
                if (!p1 || !p2) return null;

                const focusedId = selectedContainer?.id || selectedLocation?.id;
                const isDirect =
                  edge.sourceNodeId === activeLoc?.id ||
                  edge.targetNodeId === activeLoc?.id ||
                  edge.sourceNodeId === focusedId ||
                  edge.targetNodeId === focusedId;
                const midX = (p1.x + p2.x) / 2;
                const midY = (p1.y + p2.y) / 2;
                const showLabel =
                  edge.sourceNodeId <= edge.targetNodeId ||
                  !projectedTopology.projectedEdges.some(
                    (o) =>
                      o.sourceNodeId === edge.targetNodeId &&
                      o.targetNodeId === edge.sourceNodeId
                  );

                return (
                  <g key={edge.id}>
                    <line
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke={
                        isDirect
                          ? "#06b6d4"
                          : edge.isAggregated
                          ? "#475569"
                          : "#334155"
                      }
                      strokeWidth={
                        edge.isAggregated
                          ? isDirect
                            ? 2.8
                            : 2.0
                          : isDirect
                          ? 2.4
                          : 1.5
                      }
                      strokeDasharray={
                        edge.containsLockedEdge
                          ? "5 4"
                          : edge.isAggregated
                          ? "2 2"
                          : undefined
                      }
                      style={{ cursor: "pointer" }}
                      onContextMenu={(ev) =>
                        openContextMenuAt(ev, {
                          kind: "edge",
                          edgeId: edge.rawEdge.id,
                        })
                      }
                      onDoubleClick={(ev) => {
                        ev.stopPropagation();
                        if (edge.isAggregated && edge.groupedEdges) {
                          setMultiEdgeModalEdges(edge.groupedEdges);
                        } else {
                          setInlineEdgeEdit({
                            edgeId: edge.rawEdge.id,
                            midX,
                            midY,
                            value: String(edge.travel_minutes),
                          });
                        }
                      }}
                    />

                    {showLabel && (
                      <g
                        style={{ cursor: "pointer" }}
                        onContextMenu={(ev) =>
                          openContextMenuAt(ev, {
                            kind: "edge",
                            edgeId: edge.rawEdge.id,
                          })
                        }
                        onDoubleClick={(ev) => {
                          ev.stopPropagation();
                          if (edge.isAggregated && edge.groupedEdges) {
                            setMultiEdgeModalEdges(edge.groupedEdges);
                          } else {
                            setInlineEdgeEdit({
                              edgeId: edge.rawEdge.id,
                              midX,
                              midY,
                              value: String(edge.travel_minutes),
                            });
                          }
                        }}
                      >
                        {inlineEdgeEdit?.edgeId === edge.rawEdge.id ? (
                          <foreignObject
                            x={midX - 28}
                            y={midY - 12}
                            width={56}
                            height={24}
                          >
                            <input
                              type="number"
                              min={1}
                              max={240}
                              autoFocus
                              value={inlineEdgeEdit.value}
                              onChange={(ev) =>
                                setInlineEdgeEdit((prev) =>
                                  prev ? { ...prev, value: ev.target.value } : null
                                )
                              }
                              onBlur={() => {
                                handleUpdateEdgeDistance(
                                  edge.rawEdge.id,
                                  parseInt(inlineEdgeEdit.value, 10) || 1
                                );
                                setInlineEdgeEdit(null);
                              }}
                              onKeyDown={(ev) => {
                                if (ev.key === "Enter") {
                                  handleUpdateEdgeDistance(
                                    edge.rawEdge.id,
                                    parseInt(inlineEdgeEdit.value, 10) || 1
                                  );
                                  setInlineEdgeEdit(null);
                                } else if (ev.key === "Escape") {
                                  setInlineEdgeEdit(null);
                                }
                              }}
                              style={{
                                width: "100%",
                                height: "22px",
                                fontSize: "10px",
                                textAlign: "center",
                                background: "#0b0e14",
                                color: "#e2e8f0",
                                border: "1px solid #22d3ee",
                                borderRadius: 4,
                              }}
                            />
                          </foreignObject>
                        ) : (
                          <>
                            <rect
                              x={midX - 22}
                              y={midY - 9}
                              width={44}
                              height={16}
                              rx={4}
                              fill="#0b0e14"
                              fillOpacity={0.9}
                              stroke={isDirect ? "#0891b2" : "#334155"}
                              strokeWidth={1}
                            />
                            <text
                              x={midX}
                              y={midY + 2}
                              textAnchor="middle"
                              fill={isDirect ? "#67e8f9" : "#94a3b8"}
                              fontSize="8.2"
                              fontWeight="600"
                            >
                              {edge.travel_minutes}m
                              {edge.isAggregated
                                ? ` · ${edge.groupedEdges?.length ?? ""}`
                                : ""}
                              {edge.containsLockedEdge ? " 🔒" : ""}
                            </text>
                          </>
                        )}
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Rubber-band Link Creation Line */}
              {linkDrag && (
                <line
                  x1={linkDrag.startX}
                  y1={linkDrag.startY}
                  x2={linkDrag.currX}
                  y2={linkDrag.currY}
                  stroke="#22d3ee"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  pointerEvents="none"
                />
              )}

              {/* Child Container Supernodes (Levels 1-4) */}
              {projectedTopology.visibleSupernodes.map((sn) => {
                const pt = fullMapCoords[sn.container.id];
                if (!pt) return null;
                const isSelected = selectedContainer?.id === sn.container.id;
                const isDropHover =
                  nodeDrag?.hoverTarget?.kind === "container" &&
                  nodeDrag.hoverTarget.id === sn.container.id;
                const dropStroke = isDropHover
                  ? nodeDrag!.hoverTarget!.valid
                    ? "#10b981"
                    : "#f43f5e"
                  : sn.hasActivePlayer
                  ? "#f59e0b"
                  : isSelected
                  ? "#22d3ee"
                  : "#475569";

                const cardW = 148;
                const cardH = 50;
                const ContIcon = resolveMapIconComponent(
                  sn.container.icon,
                  "container",
                  sn.container.depth
                );
                const showPorts =
                  hoveredNodeKey === `cont:${sn.container.id}` ||
                  isSelected ||
                  Boolean(linkDrag);

                return (
                  <g
                    key={sn.container.id}
                    data-node-kind="container"
                    data-node-id={sn.container.id}
                    style={{ cursor: "pointer" }}
                    onMouseEnter={() => setHoveredNodeKey(`cont:${sn.container.id}`)}
                    onMouseLeave={() =>
                      setHoveredNodeKey((curr) =>
                        curr === `cont:${sn.container.id}` ? null : curr
                      )
                    }
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.stopPropagation();
                      if (isMutatingLocked) {
                        setSelectedContainerId(sn.container.id);
                        return;
                      }
                      const wpt = clientToWorldPoint(
                        e.clientX,
                        e.clientY,
                        svgRef.current,
                        viewportGroupRef.current,
                        pan,
                        zoom
                      );
                      setNodeDrag({
                        kind: "container",
                        id: sn.container.id,
                        startClientX: e.clientX,
                        startClientY: e.clientY,
                        pointerOffsetX: wpt.x - pt.x,
                        pointerOffsetY: wpt.y - pt.y,
                        origX: pt.x,
                        origY: pt.y,
                        currX: pt.x,
                        currY: pt.y,
                        hasMoved: false,
                        hoverTarget: null,
                      });
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      drillIntoContainer(sn.container.id);
                    }}
                    onContextMenu={(e) =>
                      openContextMenuAt(e, {
                        kind: "container",
                        id: sn.container.id,
                      })
                    }
                  >
                    {/* Layered stacked card back-border */}
                    <rect
                      x={pt.x - cardW / 2 + 4}
                      y={pt.y - cardH / 2 - 4}
                      width={cardW}
                      height={cardH}
                      rx={8}
                      fill="#0f172a"
                      stroke={dropStroke}
                      strokeOpacity={0.55}
                      strokeWidth={1.2}
                    />
                    <rect
                      x={pt.x - cardW / 2}
                      y={pt.y - cardH / 2}
                      width={cardW}
                      height={cardH}
                      rx={8}
                      fill={
                        isDropHover
                          ? nodeDrag!.hoverTarget!.valid
                            ? "rgba(16, 185, 129, 0.18)"
                            : "rgba(244, 63, 94, 0.2)"
                          : "#162033"
                      }
                      stroke={dropStroke}
                      strokeWidth={isDropHover || isSelected ? 2.2 : 1.5}
                    />
                    <ContIcon
                      x={pt.x - cardW / 2 + 9}
                      y={pt.y - cardH / 2 + 8}
                      width={15}
                      height={15}
                      stroke={sn.hasActivePlayer ? "#fbbf24" : "#38bdf8"}
                    />
                    <rect
                      x={pt.x + cardW / 2 - 26}
                      y={pt.y - cardH / 2 + 6}
                      width={20}
                      height={13}
                      rx={3}
                      fill="rgba(245, 158, 11, 0.16)"
                      stroke="rgba(245, 158, 11, 0.4)"
                      strokeWidth={0.8}
                    />
                    <text
                      x={pt.x + cardW / 2 - 16}
                      y={pt.y - cardH / 2 + 15}
                      textAnchor="middle"
                      fill="#fbbf24"
                      fontSize="7.8"
                      fontWeight="700"
                    >
                      L{sn.container.depth}
                    </text>
                    <text
                      x={pt.x + 2}
                      y={pt.y - 4}
                      textAnchor="middle"
                      fill={sn.hasActivePlayer ? "#fbbf24" : "#f1f5f9"}
                      fontSize="10"
                      fontWeight="700"
                    >
                      {sn.container.name.length > 15
                        ? `${sn.container.name.slice(0, 14)}…`
                        : sn.container.name}
                    </text>
                    <text
                      x={pt.x}
                      y={pt.y + 13}
                      textAnchor="middle"
                      fill="#94a3b8"
                      fontSize="8"
                    >
                      {sn.descendantLocationCount} rooms ·{" "}
                      {sn.externalPortalsCount} portals
                    </text>

                    {/* Compass link ports on container perimeter */}
                    {showPorts &&
                      !isMutatingLocked &&
                      COMPASS_ORDER.map((slot) => {
                        const a = COMPASS_ANGLES[slot];
                        const px = pt.x + Math.cos(a) * (cardW / 2 + 7);
                        const py = pt.y + Math.sin(a) * (cardH / 2 + 7);
                        return (
                          <circle
                            key={slot}
                            cx={px}
                            cy={py}
                            r={3.8}
                            fill="#0f172a"
                            stroke="#22d3ee"
                            strokeWidth={1.3}
                            style={{ cursor: "crosshair" }}
                            onPointerDown={(ev) => {
                              ev.stopPropagation();
                              setLinkDrag({
                                sourceKind: "container",
                                sourceId: sn.container.id,
                                sourceSlot: slot,
                                startX: px,
                                startY: py,
                                currX: px,
                                currY: py,
                                hoverTarget: null,
                              });
                            }}
                          />
                        );
                      })}
                  </g>
                );
              })}

              {/* Visible Level 0 Location & Passage Hub Nodes */}
              {projectedTopology.visibleLocations.map((loc) => {
                const pt = fullMapCoords[loc.id];
                if (!pt) return null;
                const isAnchorOrStart =
                  loc.id === activeLoc?.id || loc.is_starting_location;
                const isNeighbor = activeNeighborIds.has(loc.id);
                const isSelected =
                  !selectedContainer && loc.id === selectedLocation?.id;
                const isPortal = projectedTopology.dynamicPortalIds.has(loc.id);
                const isUnreachable = unreachableSet.has(loc.id);
                const isDropHover =
                  nodeDrag?.hoverTarget?.kind === "location" &&
                  nodeDrag.hoverTarget.id === loc.id;

                const IconComp = resolveMapIconComponent(
                  loc.icon,
                  loc.is_hub ? "hub" : "location"
                );

                const borderColor = isDropHover
                  ? nodeDrag!.hoverTarget!.valid
                    ? "#10b981"
                    : "#f43f5e"
                  : isAnchorOrStart
                  ? "#f59e0b"
                  : loc.is_hub
                  ? "#a855f7"
                  : isUnreachable
                  ? "#f59e0b"
                  : isSelected
                  ? "#22d3ee"
                  : isNeighbor
                  ? "#0891b2"
                  : "#475569";

                const fillColor = isAnchorOrStart
                  ? "rgba(245, 158, 11, 0.22)"
                  : loc.is_hub
                  ? "rgba(168, 85, 247, 0.22)"
                  : isNeighbor
                  ? "rgba(6, 182, 212, 0.16)"
                  : "#111827";

                const iconStroke = isAnchorOrStart
                  ? "#fbbf24"
                  : loc.is_hub
                  ? "#e9d5ff"
                  : isSelected || isNeighbor
                  ? "#67e8f9"
                  : "#cbd5e1";

                const occupiedSet =
                  occupiedSlotsByLocId.get(loc.id) ?? new Set<CompassDirection>();
                const showPorts =
                  hoveredNodeKey === `loc:${loc.id}` ||
                  isSelected ||
                  Boolean(linkDrag);

                const extExits =
                  projectedTopology.externalPortalsByLocationId[loc.id] ?? [];

                // Regular octagon points for Passage Hub
                const hubRadius = 17;
                const hubPoints = Array.from({ length: 8 }, (_, k) => {
                  const angle = (k * Math.PI) / 4 + Math.PI / 8;
                  return `${(pt.x + Math.cos(angle) * hubRadius).toFixed(1)},${(
                    pt.y +
                    Math.sin(angle) * hubRadius
                  ).toFixed(1)}`;
                }).join(" ");

                return (
                  <g
                    key={loc.id}
                    data-node-kind="location"
                    data-node-id={loc.id}
                    style={{
                      cursor: "pointer",
                      opacity:
                        mode === "campaign" && !loc.is_visited && !isSelected
                          ? 0.85
                          : 1,
                    }}
                    onMouseEnter={() => setHoveredNodeKey(`loc:${loc.id}`)}
                    onMouseLeave={() =>
                      setHoveredNodeKey((curr) =>
                        curr === `loc:${loc.id}` ? null : curr
                      )
                    }
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.stopPropagation();
                      if (isMutatingLocked) {
                        setSelectedContainerId(null);
                        setSelectedLocId(loc.id);
                        return;
                      }
                      const wpt = clientToWorldPoint(
                        e.clientX,
                        e.clientY,
                        svgRef.current,
                        viewportGroupRef.current,
                        pan,
                        zoom
                      );
                      setNodeDrag({
                        kind: "location",
                        id: loc.id,
                        startClientX: e.clientX,
                        startClientY: e.clientY,
                        pointerOffsetX: wpt.x - pt.x,
                        pointerOffsetY: wpt.y - pt.y,
                        origX: pt.x,
                        origY: pt.y,
                        currX: pt.x,
                        currY: pt.y,
                        hasMoved: false,
                        hoverTarget: null,
                      });
                    }}
                    onContextMenu={(e) =>
                      openContextMenuAt(e, { kind: "location", id: loc.id })
                    }
                  >
                    {/* Selection or Unreachable Warning Ring */}
                    {(isSelected || isUnreachable) && (
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={loc.is_hub ? 22 : 24}
                        fill="none"
                        stroke={isUnreachable ? "#f59e0b" : "#38bdf8"}
                        strokeWidth={1.8}
                        strokeDasharray="3 3"
                      />
                    )}

                    {/* Node Body: Octagon Passage Hub OR Rounded Tile Location */}
                    {loc.is_hub ? (
                      <polygon
                        points={hubPoints}
                        fill={fillColor}
                        stroke={borderColor}
                        strokeWidth={2}
                      />
                    ) : (
                      <rect
                        x={pt.x - 18}
                        y={pt.y - 18}
                        width={36}
                        height={36}
                        rx={10}
                        fill={fillColor}
                        stroke={borderColor}
                        strokeWidth={isAnchorOrStart || isSelected ? 2.2 : 1.7}
                      />
                    )}

                    <IconComp
                      x={pt.x - (loc.is_hub ? 7.5 : 8.5)}
                      y={pt.y - (loc.is_hub ? 7.5 : 8.5)}
                      width={loc.is_hub ? 15 : 17}
                      height={loc.is_hub ? 15 : 17}
                      stroke={iconStroke}
                    />

                    {/* Cyan Portal Diamond Badge */}
                    {isPortal && (
                      <g>
                        <polygon
                          points={`${pt.x + 17},${pt.y - 23} ${pt.x + 23},${pt.y - 17} ${pt.x + 17},${pt.y - 11} ${pt.x + 11},${pt.y - 17}`}
                          fill="#083344"
                          stroke="#22d3ee"
                          strokeWidth={1.4}
                        />
                        <DoorOpen
                          x={pt.x + 13.5}
                          y={pt.y - 20.5}
                          width={7}
                          height={7}
                          stroke="#67e8f9"
                        />
                      </g>
                    )}

                    {/* Unlinked / Unreachable warning dot */}
                    {isUnreachable && (
                      <g>
                        <circle
                          cx={pt.x - 17}
                          cy={pt.y - 17}
                          r={6.5}
                          fill="#78350f"
                          stroke="#fbbf24"
                          strokeWidth={1.2}
                        />
                        <text
                          x={pt.x - 17}
                          y={pt.y - 14}
                          textAnchor="middle"
                          fill="#fef3c7"
                          fontSize="8.5"
                          fontWeight="800"
                        >
                          !
                        </text>
                      </g>
                    )}

                    {/* Name Label */}
                    <text
                      x={pt.x}
                      y={pt.y + 30}
                      textAnchor="middle"
                      fill={
                        isAnchorOrStart
                          ? "#fbbf24"
                          : isSelected
                          ? "#f8fafc"
                          : "#cbd5e1"
                      }
                      fontSize="10"
                      fontWeight={isAnchorOrStart || isSelected ? "700" : "500"}
                    >
                      {loc.name}
                    </text>

                    {extExits.length > 0 && (
                      <text
                        x={pt.x}
                        y={pt.y + 41}
                        textAnchor="middle"
                        fill="#22d3ee"
                        fontSize="8"
                      >
                        ↗ {extExits[0].destination.name}
                        {extExits.length > 1 ? ` +${extExits.length - 1}` : ""}
                      </text>
                    )}

                    {/* 8 Compass Connection Link Ports */}
                    {showPorts &&
                      !isMutatingLocked &&
                      COMPASS_ORDER.map((slot) => {
                        const a = COMPASS_ANGLES[slot];
                        const px = pt.x + Math.cos(a) * 26;
                        const py = pt.y + Math.sin(a) * 26;
                        const isOccupied = occupiedSet.has(slot);
                        const isTargetHovered =
                          linkDrag?.hoverTarget?.kind === "location" &&
                          linkDrag.hoverTarget.id === loc.id &&
                          linkDrag.hoverTarget.slot === slot;

                        return (
                          <circle
                            key={slot}
                            data-link-port={`${loc.id}:${slot}`}
                            cx={px}
                            cy={py}
                            r={isTargetHovered ? 5.2 : isOccupied ? 4 : 3.4}
                            fill={
                              isTargetHovered
                                ? "#22d3ee"
                                : isOccupied
                                ? "#06b6d4"
                                : "#0f172a"
                            }
                            stroke={isOccupied ? "#a5f3fc" : "#38bdf8"}
                            strokeWidth={1.3}
                            style={{ cursor: "crosshair" }}
                            onPointerDown={(ev) => {
                              ev.stopPropagation();
                              setLinkDrag({
                                sourceKind: "location",
                                sourceId: loc.id,
                                sourceSlot: slot,
                                startX: px,
                                startY: py,
                                currX: px,
                                currY: py,
                                hoverTarget: null,
                              });
                            }}
                          />
                        );
                      })}
                  </g>
                );
              })}
            </g>
          </svg>

          {/* Drop target validation banner */}
          {nodeDrag?.hasMoved && nodeDrag.hoverTarget && (
            <div
              style={{
                position: "absolute",
                top: 10,
                left: "50%",
                transform: "translateX(-50%)",
                background: nodeDrag.hoverTarget.valid
                  ? "rgba(6, 78, 59, 0.92)"
                  : "rgba(136, 19, 55, 0.94)",
                border: `1px solid ${
                  nodeDrag.hoverTarget.valid ? "#10b981" : "#f43f5e"
                }`,
                color: nodeDrag.hoverTarget.valid ? "#a7f3d0" : "#fecdd3",
                padding: "5px 12px",
                borderRadius: 6,
                fontSize: "0.73rem",
                fontWeight: 600,
                pointerEvents: "none",
                zIndex: 20,
              }}
            >
              {nodeDrag.hoverTarget.valid
                ? nodeDrag.hoverTarget.kind === "container"
                  ? "Release to move inside container"
                  : "Release to group into a new Level 1 container"
                : nodeDrag.hoverTarget.reason || "Invalid drop target"}
            </div>
          )}

          {/* Transient feedback pill */}
          {statusNotice && !nodeDrag?.hasMoved && (
            <div
              style={{
                position: "absolute",
                top: 10,
                right: 10,
                background: "rgba(15, 23, 42, 0.92)",
                border: "1px solid rgba(56, 189, 248, 0.4)",
                color: "#e2e8f0",
                padding: "5px 10px",
                borderRadius: 6,
                fontSize: "0.72rem",
                display: "flex",
                alignItems: "center",
                gap: 8,
                zIndex: 20,
              }}
            >
              <span>{statusNotice}</span>
              <button
                type="button"
                onClick={() => setStatusNotice(null)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                <X size={12} />
              </button>
            </div>
          )}

          {/* Floating Legend Overlay */}
          <div
            style={{
              position: "absolute",
              left: 10,
              bottom: 10,
              background: "rgba(11, 14, 20, 0.9)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 6,
              padding: "5px 10px",
              fontSize: "0.69rem",
              color: "var(--text-secondary)",
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <strong style={{ color: "#f59e0b" }}>■</strong>{" "}
              {mode === "campaign" ? "Current / Start" : "Starting Hub"}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <GitBranch size={11} color="#c084fc" /> Passage Hub
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <DoorOpen size={11} color="#22d3ee" /> Portal
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Layers size={11} color="#fbbf24" /> Container
            </span>
            <span style={{ color: "var(--text-muted)", fontSize: "0.66rem" }}>
              Drag nodes · Drag ports to link · Double-click distance · Right-click for actions
            </span>
          </div>

          {/* Context Menu & Dialogs */}
          <MapContextMenu
            menu={contextMenu}
            locations={workingLocations}
            containers={workingContainers}
            edges={workingEdges}
            mode={mode}
            canDeleteContainer={canDeleteContainer}
            canDeleteLocation={canDeleteLocation}
            canConvertLocation={canConvertLocation}
            canMoveOutToParent={canMoveOutToParent}
            onClose={() => setContextMenu(null)}
            onInspect={(kind, id) => {
              if (kind === "location") {
                setSelectedContainerId(null);
                setSelectedLocId(id);
              } else {
                setSelectedContainerId(id);
              }
            }}
            onEnterContainer={drillIntoContainer}
            onSetStartingLocation={handleSetStartingLocation}
            onConvertToContainer={handleConvertLocationToContainer}
            onMoveOutToParent={(kind, id) => {
              const parentId =
                kind === "location"
                  ? locationMap.get(id)?.container_id
                  : containerMap.get(id)?.parent_container_id;
              const grandParentId = parentId
                ? containerMap.get(parentId)?.parent_container_id ?? null
                : null;
              executeImmediateContainerMove(kind, id, grandParentId);
            }}
            onDeleteLocation={handleDeleteLocation}
            onDeleteContainer={handleDeleteContainer}
            onEditEdgeDistance={(edgeId) => {
              const edge = workingEdges.find((e) => e.id === edgeId);
              if (!edge) return;
              const p1 = fullMapCoords[edge.from_location_id] ?? { x: 0, y: 0 };
              const p2 = fullMapCoords[edge.to_location_id] ?? { x: 0, y: 0 };
              setInlineEdgeEdit({
                edgeId,
                midX: (p1.x + p2.x) / 2,
                midY: (p1.y + p2.y) / 2,
                value: String(edge.travel_minutes),
              });
            }}
            onToggleEdgeLocked={handleToggleEdgeLocked}
            onDeleteEdge={handleDeleteEdge}
          />

          <PassageHubCollisionModal
            state={hubCollisionModal}
            onCancel={() => setHubCollisionModal(null)}
            onConfirm={handleConfirmHubCollision}
          />

          <EmptyCanvasCreateModal
            state={emptyCanvasModal}
            onCancel={() => setEmptyCanvasModal(null)}
            onCreate={handleConfirmEmptyCanvasCreate}
          />

          <GroupIntoContainerModal
            state={groupModal}
            onCancel={() => setGroupModal(null)}
            onConfirm={handleConfirmGroupIntoContainer}
          />

          <MultiEdgePopover
            edges={multiEdgeModalEdges}
            locationMap={locationMap}
            onClose={() => setMultiEdgeModalEdges(null)}
            onUpdateDistance={handleUpdateEdgeDistance}
            onToggleLocked={handleToggleEdgeLocked}
            onDeleteEdge={handleDeleteEdge}
          />

          {/* Cross-Boundary Portal Promotion Prompt */}
          {promotionPrompt && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Entry/Exit Portal Promotion"
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(9, 13, 22, 0.82)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 35,
                padding: 16,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  width: "min(440px, 95%)",
                  background: "var(--bg-card)",
                  border: "1px solid rgba(6, 182, 212, 0.55)",
                  borderRadius: 8,
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    fontSize: "0.88rem",
                    fontWeight: 700,
                    color: "var(--accent-cyan)",
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                  }}
                >
                  <DoorOpen size={16} />
                  Cross-Boundary Connection &amp; Portal Setup
                </div>

                {promotionPrompt.targetContainerForRoomPick && (
                  <div className="field-group" style={{ gap: 4 }}>
                    <label style={{ fontSize: "0.74rem", fontWeight: 600 }}>
                      Select Target Room Inside{" "}
                      {promotionPrompt.targetContainerForRoomPick.name}:
                    </label>
                    <select
                      className="field-select"
                      value={promotionPrompt.chosenTargetRoomId}
                      onChange={(e) => {
                        const picked =
                          promotionPrompt.targetRoomCandidates.find(
                            (r) => r.id === e.target.value
                          ) ?? promotionPrompt.toLocation;
                        setPromotionPrompt({
                          ...promotionPrompt,
                          toLocation: picked,
                          chosenTargetRoomId: picked.id,
                          candidates: computePromotionCandidates(
                            promotionPrompt.fromLocation,
                            picked,
                            containerMap,
                            projectedTopology.dynamicPortalIds
                          ),
                        });
                      }}
                    >
                      {promotionPrompt.targetRoomCandidates.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                          {projectedTopology.dynamicPortalIds.has(r.id)
                            ? " [Portal]"
                            : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {promotionPrompt.candidates.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 7,
                      fontSize: "0.76rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <div>
                      Connecting{" "}
                      <strong>{promotionPrompt.fromLocation.name}</strong> →{" "}
                      <strong>{promotionPrompt.toLocation.name}</strong> crosses a
                      Level 1 container boundary. Mark interior room(s) as
                      Entry/Exit Portals:
                    </div>
                    {promotionPrompt.candidates.map((cand) => (
                      <label
                        key={cand.location.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          background: "var(--bg-panel)",
                          padding: "6px 9px",
                          borderRadius: 6,
                          border: "1px solid var(--border-subtle)",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={cand.promote}
                          onChange={(e) =>
                            setPromotionPrompt({
                              ...promotionPrompt,
                              candidates: promotionPrompt.candidates.map((c) =>
                                c.location.id === cand.location.id
                                  ? { ...c, promote: e.target.checked }
                                  : c
                              ),
                            })
                          }
                        />
                        <span>
                          Promote <strong>{cand.location.name}</strong> to{" "}
                          <span style={{ color: "var(--accent-cyan)" }}>
                            [Entry/Exit Portal]
                          </span>{" "}
                          for {cand.container.name}
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 8,
                    marginTop: 4,
                  }}
                >
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "4px 10px", fontSize: "0.74rem" }}
                    onClick={() => setPromotionPrompt(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-cyan"
                    style={{ padding: "4px 12px", fontSize: "0.74rem" }}
                    onClick={() =>
                      executeDirectEdgeCreation(
                        promotionPrompt.fromLocation,
                        promotionPrompt.toLocation,
                        promotionPrompt.direction,
                        promotionPrompt.travelMinutes,
                        promotionPrompt.bidirectional,
                        new Set(
                          promotionPrompt.candidates
                            .filter((c) => c.promote)
                            .map((c) => c.location.id)
                        )
                      )
                    }
                  >
                    Confirm &amp; Connect
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Details Drawer (hidden when empty canvas clicked) */}
        {hasDetailsOpen && (
          <MapDetailsDrawer
            mode={mode}
            selectedLocation={selectedLocation}
            selectedContainer={selectedContainer}
            containers={workingContainers}
            allLocations={workingLocations}
            dynamicPortalIds={projectedTopology.dynamicPortalIds}
            externalPortals={selectedExternalPortals}
            containerStats={selectedContainerStats}
            activeLocId={activeLoc?.id}
            worldContext={worldContext}
            isMutatingLocked={isMutatingLocked}
            isLocationSavedInDb={
              selectedLocation
                ? baselineLocationIds.has(selectedLocation.id)
                : false
            }
            isContainerSavedInDb={
              selectedContainer
                ? baselineContainerIds.has(selectedContainer.id)
                : false
            }
            depthLabels={CONTAINER_DEPTH_LABELS}
            onClose={() => {
              setSelectedLocId(null);
              setSelectedContainerId(null);
            }}
            onPatchLocation={patchLocation}
            onPatchContainer={patchContainer}
            onResetCoordinates={resetCoordinates}
            onDrillIntoContainer={drillIntoContainer}
            onOverrideLocation={onOverrideLocation}
            isOverriding={isOverriding}
            onSaveCampaignLocationLore={onSaveCampaignLocationLore}
            onSaveCampaignContainerLore={onSaveCampaignContainerLore}
          />
        )}
      </div>
    </div>
  );
};
