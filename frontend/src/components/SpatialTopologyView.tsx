import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  Crosshair,
  DoorOpen,
  EyeOff,
  FolderOpen,
  GitBranch,
  Layers,
  Link2,
  Lock,
  LogIn,
  MapPin,
  Navigation,
  Pencil,
  Plus,
  Sparkles,
  Star,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  CompassDirection,
  LOCATION_LORE_CATEGORIES,
  LocationContainer,
  LocationEdge,
  LocationLoreCategory,
  LocationLoreNodeDraft,
  LocationNode,
  LoreNode,
} from "../types";
import { TagChipsInput, normalizeTagList } from "./TagChipsInput";

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
        (startIdx + offset * sign + COMPASS_ORDER.length) %
        COMPASS_ORDER.length;
      const cand = COMPASS_ORDER[idx];
      if (!occupied.has(cand)) return cand;
    }
  }
  return base;
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
    if (!locContainer.has(edge.from_location_id) || !locContainer.has(edge.to_location_id)) {
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

  // Resolve any containerId to the direct child container under validCurrentId (or null if outside subtree)
  const ancestorCache = new Map<string, string | null>();
  const resolveChildUnderCurrent = (containerId: string | null | undefined): string | null => {
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
    const locContId = loc.container_id && byId.has(loc.container_id) ? loc.container_id : null;
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

  // Group character presence per location ID
  const charsAtLoc = new Map<string, string[]>();
  if (presentCharacterLocations) {
    for (const [charId, locId] of Object.entries(presentCharacterLocations)) {
      if (!charsAtLoc.has(locId)) charsAtLoc.set(locId, []);
      charsAtLoc.get(locId)!.push(charId);
    }
  }

  const visibleSupernodes: ProjectedContainerSupernode[] = childContainers.map((cc) => {
    const descendants = descendantLocsBySupernode.get(cc.id) ?? [];
    const directCount = descendants.filter((l) => l.container_id === cc.id).length;
    const portalDesc = descendants.filter((l) => dynamicPortalIds.has(l.id));
    const presentIds: string[] = [];
    for (const d of descendants) {
      const list = charsAtLoc.get(d.id);
      if (list) presentIds.push(...list);
    }
    const activeLocMapping = activeLocationId ? visibleByLocId.get(activeLocationId) : undefined;
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
  });

  const locMap = new Map(locations.map((l) => [l.id, l]));
  const externalPortalsByLocationId: Record<string, ProjectedExternalPortalDestination[]> = {};
  const projectedEdges: ProjectedTopologyEdge[] = [];
  const aggregatedGroups = new Map<
    string,
    {
      sourceNodeId: string;
      targetNodeId: string;
      edges: LocationEdge[];
    }
  >();

  for (const edge of edges) {
    const fromVis = visibleByLocId.get(edge.from_location_id);
    const toVis = visibleByLocId.get(edge.to_location_id);

    if (fromVis && !toVis) {
      // Cross-boundary edge leaving currentContainer view
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
    if (fromVis.id === toVis.id) continue; // Internal edge entirely inside one collapsed supernode

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
    });
  }

  // Anchor resolution for radial BFS layout:
  // Active player node -> active supernode -> entry/exit portal in current container -> first visible node
  const activeVis = activeLocationId ? visibleByLocId.get(activeLocationId) : undefined;
  const portalInCurrent = visibleLocations.find((l) => dynamicPortalIds.has(l.id));
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

export function computeFullMapCoords(
  locations: LocationNode[],
  edges: LocationEdge[],
  activeLocId: string
): Record<string, { x: number; y: number }> {
  const coords: Record<string, { x: number; y: number }> = {};
  if (locations.length === 0) return coords;

  const locById = new Map(locations.map((l) => [l.id, l]));
  const startId = locById.has(activeLocId) ? activeLocId : locations[0].id;
  coords[startId] = { x: 0, y: 0 };

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

  const visited = new Set<string>([startId]);
  const queue: string[] = [startId];
  const stepDist = 175;

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const currPt = coords[curr];
    const outgoing = adj.get(curr) ?? [];
    const usedSlots = new Set<CompassDirection>();

    for (const item of outgoing) {
      if (visited.has(item.to)) continue;
      visited.add(item.to);
      const slot = pickCompassSlot(item.dir, usedSlots);
      usedSlots.add(slot);
      const angle = COMPASS_ANGLES[slot];
      coords[item.to] = {
        x: currPt.x + Math.cos(angle) * stepDist,
        y: currPt.y + Math.sin(angle) * stepDist,
      };
      queue.push(item.to);
    }
  }

  // Place any unvisited/disconnected locations in an outer ring
  const unvisited = locations.filter((l) => !visited.has(l.id));
  unvisited.forEach((loc, idx) => {
    const angle =
      (idx / Math.max(1, unvisited.length)) * Math.PI * 2 - Math.PI / 2;
    coords[loc.id] = {
      x: Math.cos(angle) * (stepDist * 2.2),
      y: Math.sin(angle) * (stepDist * 2.2),
    };
  });

  // Iterative collision repulsion so multi-hop nodes never overlap
  const ids = Object.keys(coords);
  const minDist = 115;
  for (let iter = 0; iter < 36; iter++) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const idA = ids[i];
        const idB = ids[j];
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
          if (idA === startId) {
            pB.x += ox * 2;
            pB.y += oy * 2;
          } else if (idB === startId) {
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
  /** When user connected to a container supernode without unambiguous portal, let them choose target room. */
  targetContainerForRoomPick: LocationContainer | null;
  targetRoomCandidates: LocationNode[];
  chosenTargetRoomId: string;
  direction: CompassDirection;
  travelMinutes: number;
  bidirectional: boolean;
  candidates: PromotionCandidate[];
}

/** Compute Level 1 non-portal interior endpoints eligible for Portal Promotion Prompt. */
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

export interface SpatialTopologyViewProps {
  title?: string;
  containers?: LocationContainer[];
  locations: LocationNode[];
  edges: LocationEdge[];
  /** In Campaign mode: current active scene location. In World Sheet: starting hub location. */
  activeLocationId: string;
  defaultSelectedLocationId?: string;
  presentCharacterLocations?: Record<string, string>;
  mode: "campaign" | "editor";

  // Optional Close callback (used when rendered in a modal overlay)
  onClose?: () => void;

  // Optional Re-imagine Map callback (AI topology generation)
  onReimagineMap?: () => void;

  // Editor mode actions (staged updates in World Sheet)
  onUpdateLocation?: (updated: LocationNode) => void;
  onUpdateContainer?: (updated: LocationContainer) => void;
  onConvertToContainer?: (location: LocationNode) => void;
  onDeleteLocation?: (locationId: string) => void;
  onSetStartingLocation?: (locationId: string) => void;
  onAddEdge?: (payload: {
    from_location_id: string;
    to_location_id: string;
    direction_label?: string;
    compass_direction: CompassDirection;
    travel_minutes: number;
    bidirectional?: boolean;
  }) => Promise<void> | void;
  onDeleteEdge?: (edgeId: string) => Promise<void> | void;
  onUpdateEdgeDistance?: (payload: {
    edgeId: string;
    travel_minutes: number;
  }) => Promise<void> | void;

  // Link Creation (supported in both modes)
  onCreateLinkedLocation?: (payload: {
    from_location_id: string;
    name: string;
    compass_direction: CompassDirection;
    travel_minutes: number;
    description: string;
    environmental_tags: string[];
    is_hub?: boolean;
    summary?: string;
  }) => Promise<string | void> | void;

  // Campaign mode actions
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
  containers = [],
  locations,
  edges,
  activeLocationId,
  defaultSelectedLocationId,
  presentCharacterLocations,
  mode,
  onClose,
  onReimagineMap,
  onUpdateLocation,
  onUpdateContainer,
  onConvertToContainer,
  onDeleteLocation,
  onSetStartingLocation,
  onAddEdge,
  onDeleteEdge,
  onUpdateEdgeDistance,
  onCreateLinkedLocation,
  onOverrideLocation,
  isOverriding = false,
  onSaveCampaignLocationLore,
  onSaveCampaignContainerLore,
  isMutatingLocked = false,
}) => {
  const initialActiveLoc =
    locations.find((l) => l.id === (defaultSelectedLocationId || activeLocationId)) ??
    locations[0];
  const [currentContainerId, setCurrentContainerId] = useState<string | null>(() => {
    if (mode === "campaign" && containers.length > 0) {
      return initialActiveLoc?.container_id ?? null;
    }
    return null;
  });
  const [selectedLocId, setSelectedLocId] = useState<string>(
    defaultSelectedLocationId || activeLocationId || locations[0]?.id || ""
  );
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null);
  const [promotionPrompt, setPromotionPrompt] = useState<PromotionPromptState | null>(null);

  // Pan and zoom state for the SVG canvas
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  }>({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  // "Create Link" form state
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkName, setLinkName] = useState("");
  const [linkDirection, setLinkDirection] = useState<CompassDirection>("N");
  const [linkMinutes, setLinkMinutes] = useState("2");
  const [linkDescription, setLinkDescription] = useState("");
  const [linkTags, setLinkTags] = useState("");
  const [linkIsHub, setLinkIsHub] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [isCreatingLink, setIsCreatingLink] = useState(false);

  // "Connect Existing Location" form state
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [connectTargetId, setConnectTargetId] = useState<string>("");
  const [connectDirection, setConnectDirection] = useState<CompassDirection>("N");
  const [connectMinutes, setConnectMinutes] = useState("2");
  const [connectBidirectional, setConnectBidirectional] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // Distance editing state
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [editMinutes, setEditMinutes] = useState<string>("1");
  const [isUpdatingDistance, setIsUpdatingDistance] = useState(false);

  // Refs for scrolling and container constraints
  const linkFormRef = useRef<HTMLDivElement>(null);
  const connectFormRef = useRef<HTMLDivElement>(null);
  const inspectorScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll new room form into view when opened
  useEffect(() => {
    if (showLinkForm && linkFormRef.current) {
      linkFormRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [showLinkForm]);

  // Auto-scroll connect room form into view when opened
  useEffect(() => {
    if (showConnectForm && connectFormRef.current) {
      connectFormRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [showConnectForm]);

  // Removing edge state
  const [isRemovingEdgeId, setIsRemovingEdgeId] = useState<string | null>(null);

  // Scoped Lore editing state (shared by Location Lore and L1 Container Lore)
  const [expandedEditorLoreId, setExpandedEditorLoreId] = useState<string | null>(
    null
  );
  const [campLoreFormMode, setCampLoreFormMode] = useState<
    null | { mode: "add" } | { mode: "edit"; index: number }
  >(null);
  const [campLoreTitle, setCampLoreTitle] = useState("");
  const [campLoreCategory, setCampLoreCategory] =
    useState<LocationLoreCategory>("rumor");
  const [campLoreContent, setCampLoreContent] = useState("");
  const [campLoreTags, setCampLoreTags] = useState<string[]>([]);
  const [campLorePendingTagDraft, setCampLorePendingTagDraft] = useState("");
  const [campLoreError, setCampLoreError] = useState<string | null>(null);
  const [isSavingCampLore, setIsSavingCampLore] = useState(false);

  // Keep selectedLocId & currentContainerId valid if underlying lists change
  useEffect(() => {
    if (
      currentContainerId &&
      !containers.some((c) => c.id === currentContainerId)
    ) {
      setCurrentContainerId(null);
    }
  }, [containers, currentContainerId]);

  useEffect(() => {
    if (
      selectedContainerId &&
      !containers.some((c) => c.id === selectedContainerId)
    ) {
      setSelectedContainerId(null);
    }
  }, [containers, selectedContainerId]);

  useEffect(() => {
    if (locations.length === 0) return;
    const exists = locations.some((l) => l.id === selectedLocId);
    if (!exists) {
      setSelectedLocId(activeLocationId || locations[0].id);
    }
  }, [locations, selectedLocId, activeLocationId]);

  useEffect(() => {
    setShowLinkForm(false);
    setShowConnectForm(false);
    setCampLoreFormMode(null);
    setCampLoreError(null);
    setCampLorePendingTagDraft("");
  }, [selectedLocId, selectedContainerId]);

  const activeLoc = useMemo(
    () =>
      locations.find((l) => l.id === activeLocationId) ??
      locations.find((l) => l.is_starting_location) ??
      locations[0],
    [locations, activeLocationId]
  );

  const selectedLocation = useMemo(
    () => locations.find((l) => l.id === selectedLocId) ?? activeLoc,
    [locations, selectedLocId, activeLoc]
  );

  const containerMap = useMemo(
    () => new Map(containers.map((c) => [c.id, c])),
    [containers]
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
        containers,
        locations,
        edges,
        activeLoc?.id,
        presentCharacterLocations
      ),
    [
      currentContainerId,
      containers,
      locations,
      edges,
      activeLoc?.id,
      presentCharacterLocations,
    ]
  );

  // Memoize graph topology coordinates using projected visible nodes + supernodes
  const topologyKey = useMemo(() => {
    const locIds = projectedTopology.visibleLocations
      .map((l) => l.id)
      .sort()
      .join(",");
    const supIds = projectedTopology.visibleSupernodes
      .map((s) => s.container.id)
      .sort()
      .join(",");
    const edgeKeys = projectedTopology.projectedEdges
      .map((e) => `${e.sourceNodeId}->${e.targetNodeId}`)
      .sort()
      .join(",");
    return `${currentContainerId ?? "root"}::${locIds}::${supIds}::${edgeKeys}::${projectedTopology.anchorNodeId}`;
  }, [projectedTopology, currentContainerId]);

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
    return computeFullMapCoords(
      pseudoNodes,
      pseudoEdges,
      projectedTopology.anchorNodeId
    );
  }, [topologyKey]);

  const locMap = useMemo(
    () => new Map(locations.map((l) => [l.id, l])),
    [locations]
  );

  // Connected exits originating from the selected location
  const selectedLocExits = useMemo(() => {
    if (!selectedLocation) return [];
    return edges
      .filter((e) => e.from_location_id === selectedLocation.id)
      .map((e) => ({
        edge: e,
        dest: locMap.get(e.to_location_id),
      }))
      .filter(
        (item): item is { edge: LocationEdge; dest: LocationNode } =>
          Boolean(item.dest)
      );
  }, [edges, selectedLocation, locMap]);

  // Occupied exits from this node
  const occupiedDirections = useMemo(() => {
    return new Set(
      selectedLocExits
        .map((ex) => ex.edge.compass_direction)
        .filter((d): d is CompassDirection => Boolean(d))
    );
  }, [selectedLocExits]);

  // Immediate neighbors of active location for styling
  const activeNeighborIds = useMemo(() => {
    if (!activeLoc) return new Set<string>();
    return new Set(
      edges
        .filter((e) => e.from_location_id === activeLoc.id)
        .map((e) => e.to_location_id)
    );
  }, [edges, activeLoc]);

  const selectLocationNode = (locId: string) => {
    setSelectedContainerId(null);
    setSelectedLocId(locId);
  };

  const selectContainerNode = (contId: string) => {
    setSelectedContainerId(contId);
  };

  const drillIntoContainer = (contId: string | null) => {
    setCurrentContainerId(contId);
    setSelectedContainerId(null);
    setPan({ x: 0, y: 0 });
    setZoom(1);
  };

  const handleCenter = () => {
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
  };

  const openLinkForm = (asHub = false) => {
    const firstFreeSlot =
      COMPASS_ORDER.find((d) => !occupiedDirections.has(d)) ?? "N";
    setLinkName(asHub ? `${selectedLocation?.name || "Sector"} — Passage` : "");
    setLinkDirection(firstFreeSlot);
    setLinkMinutes(asHub ? "1" : "2");
    setLinkDescription(
      asHub
        ? "A connecting passageway and transit corridor linking adjoining sectors."
        : ""
    );
    setLinkTags(asHub ? "hub, passageway" : "");
    setLinkIsHub(asHub);
    setLinkError(null);
    setShowLinkForm(true);
    setShowConnectForm(false);
    setTimeout(() => {
      linkFormRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  };

  const submitLinkForm = async () => {
    if (!onCreateLinkedLocation || !selectedLocation || isCreatingLink) return;
    setIsCreatingLink(true);
    setLinkError(null);
    try {
      const minutes = Math.max(1, Math.min(240, parseInt(linkMinutes, 10) || 1));
      const tags = linkTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const newId = await onCreateLinkedLocation({
        from_location_id: selectedLocation.id,
        name: linkName.trim(),
        compass_direction: linkDirection,
        travel_minutes: minutes,
        description: linkDescription.trim(),
        environmental_tags: tags,
        is_hub: linkIsHub,
        summary: linkName.trim(),
      });
      setShowLinkForm(false);
      if (newId) {
        selectLocationNode(newId);
      }
    } catch (err) {
      setLinkError(String(err));
    } finally {
      setIsCreatingLink(false);
    }
  };

  const openConnectForm = () => {
    const connectedDestIds = new Set(
      edges
        .filter((e) => e.from_location_id === selectedLocation?.id)
        .map((e) => e.to_location_id)
    );
    const availableTargets = locations.filter(
      (l) => l.id !== selectedLocation?.id && !connectedDestIds.has(l.id)
    );
    setConnectTargetId(
      availableTargets[0]?.id ||
        locations.find((l) => l.id !== selectedLocation?.id)?.id ||
        ""
    );
    const firstFreeSlot =
      COMPASS_ORDER.find((d) => !occupiedDirections.has(d)) ?? "N";
    setConnectDirection(firstFreeSlot);
    setConnectMinutes("2");
    setConnectBidirectional(true);
    setConnectError(null);
    setShowConnectForm(true);
    setShowLinkForm(false);
    setTimeout(() => {
      connectFormRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  };

  const buildPromotionCandidates = (
    fromLoc: LocationNode,
    toLoc: LocationNode
  ): PromotionCandidate[] =>
    computePromotionCandidates(
      fromLoc,
      toLoc,
      containerMap,
      projectedTopology.dynamicPortalIds
    );

  const executeEdgeCreation = async (
    fromLoc: LocationNode,
    toLoc: LocationNode,
    direction: CompassDirection,
    minutes: number,
    bidirectional: boolean,
    promoteLocIds: Set<string>
  ) => {
    if (!onAddEdge) return;
    if (mode === "editor" && onUpdateLocation) {
      if (promoteLocIds.has(fromLoc.id)) {
        onUpdateLocation({ ...fromLoc, is_entry_exit: true });
      }
      if (promoteLocIds.has(toLoc.id) && toLoc.id !== fromLoc.id) {
        onUpdateLocation({ ...toLoc, is_entry_exit: true });
      }
    }
    setIsConnecting(true);
    try {
      await onAddEdge({
        from_location_id: fromLoc.id,
        to_location_id: toLoc.id,
        direction_label: `Passage to ${toLoc.name || "adjoining sector"}`,
        compass_direction: direction,
        travel_minutes: minutes,
        bidirectional,
      });
      setShowConnectForm(false);
      setPromotionPrompt(null);
    } catch (err: any) {
      setConnectError(err?.message || "Failed to connect locations");
    } finally {
      setIsConnecting(false);
    }
  };

  const submitConnectForm = async () => {
    if (!onAddEdge || !selectedLocation || !connectTargetId || isConnecting) return;
    setConnectError(null);
    const minutes = Math.max(
      1,
      Math.min(240, parseInt(connectMinutes, 10) || 1)
    );

    if (connectTargetId.startsWith("cont:")) {
      const targetContId = connectTargetId.slice(5);
      const targetCont = containerMap.get(targetContId);
      if (!targetCont) return;

      // Gather descendant locations inside targetCont
      const descendantIds = new Set<string>([targetCont.id]);
      let added = true;
      while (added) {
        added = false;
        for (const c of containers) {
          if (
            c.parent_container_id &&
            descendantIds.has(c.parent_container_id) &&
            !descendantIds.has(c.id)
          ) {
            descendantIds.add(c.id);
            added = true;
          }
        }
      }
      const roomsInCont = locations.filter(
        (l) => l.container_id && descendantIds.has(l.container_id)
      );
      if (roomsInCont.length === 0) {
        setConnectError(
          `"${targetCont.name}" has 0 interior rooms. Add an interior room first before linking to it.`
        );
        return;
      }

      const existingPortals = roomsInCont.filter((l) =>
        projectedTopology.dynamicPortalIds.has(l.id)
      );
      if (existingPortals.length === 1) {
        const chosenTarget = existingPortals[0];
        const candidates = buildPromotionCandidates(selectedLocation, chosenTarget);
        if (candidates.length > 0) {
          setPromotionPrompt({
            fromLocation: selectedLocation,
            toLocation: chosenTarget,
            targetContainerForRoomPick: null,
            targetRoomCandidates: [],
            chosenTargetRoomId: chosenTarget.id,
            direction: connectDirection,
            travelMinutes: minutes,
            bidirectional: connectBidirectional,
            candidates,
          });
          return;
        }
        await executeEdgeCreation(
          selectedLocation,
          chosenTarget,
          connectDirection,
          minutes,
          connectBidirectional,
          new Set()
        );
        return;
      }

      // 0 or multiple portals inside target container -> prompt to select interior room + portal promotions
      const roomPool = existingPortals.length > 1 ? existingPortals : roomsInCont;
      const initialTarget = roomPool[0];
      setPromotionPrompt({
        fromLocation: selectedLocation,
        toLocation: initialTarget,
        targetContainerForRoomPick: targetCont,
        targetRoomCandidates: roomPool,
        chosenTargetRoomId: initialTarget.id,
        direction: connectDirection,
        travelMinutes: minutes,
        bidirectional: connectBidirectional,
        candidates: buildPromotionCandidates(selectedLocation, initialTarget),
      });
      return;
    }

    const targetLoc = locMap.get(connectTargetId);
    if (!targetLoc) return;
    const candidates = buildPromotionCandidates(selectedLocation, targetLoc);
    if (candidates.length > 0) {
      setPromotionPrompt({
        fromLocation: selectedLocation,
        toLocation: targetLoc,
        targetContainerForRoomPick: null,
        targetRoomCandidates: [],
        chosenTargetRoomId: targetLoc.id,
        direction: connectDirection,
        travelMinutes: minutes,
        bidirectional: connectBidirectional,
        candidates,
      });
      return;
    }

    await executeEdgeCreation(
      selectedLocation,
      targetLoc,
      connectDirection,
      minutes,
      connectBidirectional,
      new Set()
    );
  };

  // Check if removing an edge would create isolated islands (both endpoints must retain a path to the starting hub)
  const canRemoveEdge = (edge: LocationEdge): boolean => {
    const startId =
      locations.find((l) => l.is_starting_location)?.id ?? locations[0]?.id;
    if (!startId) return false;

    const edgesToRemove = new Set<string>([edge.id]);
    for (const e of edges) {
      if (
        e.from_location_id === edge.to_location_id &&
        e.to_location_id === edge.from_location_id
      ) {
        edgesToRemove.add(e.id);
      }
    }

    const remaining = edges.filter((e) => !edgesToRemove.has(e.id));
    if (remaining.length === 0) return false;

    const adj = new Map<string, Set<string>>();
    for (const e of remaining) {
      if (!adj.has(e.from_location_id)) adj.set(e.from_location_id, new Set());
      if (!adj.has(e.to_location_id)) adj.set(e.to_location_id, new Set());
      adj.get(e.from_location_id)!.add(e.to_location_id);
      adj.get(e.to_location_id)!.add(e.from_location_id);
    }

    const reachable = new Set<string>([startId]);
    const queue = [startId];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const nextId of adj.get(curr) ?? []) {
        if (!reachable.has(nextId)) {
          reachable.add(nextId);
          queue.push(nextId);
        }
      }
    }

    return (
      reachable.has(edge.from_location_id) && reachable.has(edge.to_location_id)
    );
  };

  const handleSaveDistance = async (edgeId: string) => {
    if (!onUpdateEdgeDistance || isUpdatingDistance) return;
    const mins = Math.max(1, Math.min(240, parseInt(editMinutes, 10) || 1));
    try {
      setIsUpdatingDistance(true);
      await onUpdateEdgeDistance({ edgeId, travel_minutes: mins });
      setEditingEdgeId(null);
    } catch (err) {
      console.error("Failed to update edge distance:", err);
    } finally {
      setIsUpdatingDistance(false);
    }
  };

  const handleDeleteExit = async (edge: LocationEdge) => {
    if (!onDeleteEdge || isRemovingEdgeId) return;
    if (!canRemoveEdge(edge)) return;
    try {
      setIsRemovingEdgeId(edge.id);
      await onDeleteEdge(edge.id);
    } catch (err) {
      console.error("Failed to remove exit:", err);
    } finally {
      setIsRemovingEdgeId(null);
    }
  };

  if (!selectedLocation && locations.length === 0) {
    return (
      <div
        style={{
          padding: 30,
          textAlign: "center",
          color: "var(--text-muted)",
          background: "var(--bg-deep)",
          borderRadius: 8,
          border: "1px solid var(--border-subtle)",
        }}
      >
        <Compass
          size={32}
          color="var(--accent-cyan)"
          style={{ marginBottom: 8, opacity: 0.6 }}
        />
        <div style={{ fontSize: "0.9rem", color: "var(--text-secondary)" }}>
          No spatial locations defined in this world yet.
        </div>
      </div>
    );
  }

  const isCurrentOrStart = selectedLocation?.id === activeLoc?.id;

  const renderScopedLoreSection = (opts: {
    targetId: string;
    targetName: string;
    worldId: string;
    scopeLabel: string;
    emptyText: string;
    loreList: LoreNode[];
    onEditorUpdate?: (nextLore: LoreNode[]) => void;
    onCampaignSave?: (
      id: string,
      drafts: LocationLoreNodeDraft[]
    ) => Promise<void> | void;
  }) => {
    const {
      targetId,
      targetName,
      worldId,
      scopeLabel,
      emptyText,
      loreList,
      onEditorUpdate,
      onCampaignSave,
    } = opts;

    const updateEditorLoreAt = (idx: number, patch: Partial<LoreNode>) => {
      if (!onEditorUpdate) return;
      onEditorUpdate(
        loreList.map((item, i) => (i === idx ? { ...item, ...patch } : item))
      );
    };

    const handleAddEditorLore = () => {
      if (!onEditorUpdate) return;
      const newId = `new_lore_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      const created: LoreNode = {
        id: newId,
        world_id: worldId,
        location_id: scopeLabel.startsWith("Location") ? targetId : null,
        container_id: scopeLabel.startsWith("Container") ? targetId : null,
        title: "",
        category: "rumor",
        content: "",
        entity_tags: [],
      };
      onEditorUpdate([...loreList, created]);
      setExpandedEditorLoreId(newId);
    };

    const handleDeleteEditorLore = (idx: number) => {
      if (!onEditorUpdate) return;
      const removed = loreList[idx];
      onEditorUpdate(loreList.filter((_, i) => i !== idx));
      if (removed && expandedEditorLoreId === removed.id) {
        setExpandedEditorLoreId(null);
      }
    };

    const openCampaignAddLore = () => {
      setCampLoreFormMode({ mode: "add" });
      setCampLoreTitle("");
      setCampLoreCategory("rumor");
      setCampLoreContent("");
      setCampLoreTags([]);
      setCampLorePendingTagDraft("");
      setCampLoreError(null);
    };

    const openCampaignEditLore = (idx: number) => {
      const target = loreList[idx];
      if (!target) return;
      setCampLoreFormMode({ mode: "edit", index: idx });
      setCampLoreTitle(target.title);
      setCampLoreCategory(
        LOCATION_LORE_CATEGORIES.includes(
          target.category as LocationLoreCategory
        )
          ? (target.category as LocationLoreCategory)
          : "rumor"
      );
      setCampLoreContent(target.content);
      setCampLoreTags([...target.entity_tags]);
      setCampLorePendingTagDraft("");
      setCampLoreError(null);
    };

    const submitCampaignLoreForm = async () => {
      if (!onCampaignSave || !campLoreFormMode || isSavingCampLore) return;
      const trimmedTitle = campLoreTitle.trim();
      const trimmedContent = campLoreContent.trim();
      const pendingParts = campLorePendingTagDraft
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const effectiveTags = normalizeTagList(campLoreTags, pendingParts);

      if (!trimmedTitle) {
        setCampLoreError("Lore title is required.");
        return;
      }
      if (!trimmedContent) {
        setCampLoreError("Lore content is required.");
        return;
      }
      if (effectiveTags.length === 0) {
        setCampLoreError("At least 1 trigger keyword is required.");
        return;
      }

      const baseDrafts: LocationLoreNodeDraft[] = loreList.map((ln) => ({
        id: ln.id,
        title: ln.title,
        category: LOCATION_LORE_CATEGORIES.includes(
          ln.category as LocationLoreCategory
        )
          ? (ln.category as LocationLoreCategory)
          : "rumor",
        content: ln.content,
        entity_tags: ln.entity_tags,
      }));

      if (campLoreFormMode.mode === "add") {
        baseDrafts.push({
          title: trimmedTitle,
          category: campLoreCategory,
          content: trimmedContent,
          entity_tags: effectiveTags,
        });
      } else {
        const existingId = loreList[campLoreFormMode.index]?.id ?? null;
        baseDrafts[campLoreFormMode.index] = {
          id: existingId,
          title: trimmedTitle,
          category: campLoreCategory,
          content: trimmedContent,
          entity_tags: effectiveTags,
        };
      }

      setIsSavingCampLore(true);
      setCampLoreError(null);
      try {
        await onCampaignSave(targetId, baseDrafts);
        setCampLoreFormMode(null);
        setCampLorePendingTagDraft("");
      } catch (err: any) {
        setCampLoreError(err?.message || "Failed to save lore.");
      } finally {
        setIsSavingCampLore(false);
      }
    };

    const handleDeleteCampaignLore = async (idx: number) => {
      if (!onCampaignSave || isSavingCampLore || isMutatingLocked) return;
      const target = loreList[idx];
      if (!target) return;
      if (!window.confirm(`Remove lore "${target.title}" from this campaign?`)) {
        return;
      }
      const remaining: LocationLoreNodeDraft[] = loreList
        .filter((_, i) => i !== idx)
        .map((ln) => ({
          id: ln.id,
          title: ln.title,
          category: LOCATION_LORE_CATEGORIES.includes(
            ln.category as LocationLoreCategory
          )
            ? (ln.category as LocationLoreCategory)
            : "rumor",
          content: ln.content,
          entity_tags: ln.entity_tags,
        }));

      setIsSavingCampLore(true);
      setCampLoreError(null);
      try {
        await onCampaignSave(targetId, remaining);
        if (
          campLoreFormMode?.mode === "edit" &&
          campLoreFormMode.index === idx
        ) {
          setCampLoreFormMode(null);
        }
      } catch (err: any) {
        setCampLoreError(err?.message || "Failed to delete lore.");
      } finally {
        setIsSavingCampLore(false);
      }
    };

    return (
      <div
        style={{
          borderTop: "1px solid var(--border-subtle)",
          paddingTop: 10,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            className="cog-step-label"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              marginBottom: 0,
            }}
          >
            <BookOpen size={12} color="var(--accent-cyan)" />
            {scopeLabel} ({loreList.length})
          </span>

          {mode === "editor" && onEditorUpdate && (
            <button
              type="button"
              className="btn"
              style={{ padding: "3px 8px", fontSize: "0.7rem" }}
              onClick={handleAddEditorLore}
            >
              <Plus size={11} /> Add Lore
            </button>
          )}

          {mode === "campaign" && onCampaignSave && !campLoreFormMode && (
            <button
              type="button"
              className="btn"
              style={{ padding: "3px 8px", fontSize: "0.7rem" }}
              disabled={isMutatingLocked || isSavingCampLore}
              onClick={openCampaignAddLore}
            >
              <Plus size={11} /> Add Lore
            </button>
          )}
        </div>

        {mode === "campaign" && isMutatingLocked && (
          <div style={{ fontSize: "0.69rem", color: "var(--accent-amber)" }}>
            Turn in progress — lore editing is temporarily locked.
          </div>
        )}

        {campLoreError && mode === "campaign" && !campLoreFormMode && (
          <div style={{ fontSize: "0.71rem", color: "#fda4af" }}>
            {campLoreError}
          </div>
        )}

        {mode === "campaign" && campLoreFormMode && (
          <div
            style={{
              border: "1px solid rgba(6, 182, 212, 0.45)",
              borderRadius: 6,
              padding: 10,
              background: "var(--bg-panel)",
              display: "flex",
              flexDirection: "column",
              gap: 7,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span className="cog-step-label" style={{ marginBottom: 0 }}>
                {campLoreFormMode.mode === "add"
                  ? `New Lore for ${targetName}`
                  : `Edit ${scopeLabel}`}
              </span>
              <span style={{ fontSize: "0.64rem", color: "var(--text-muted)" }}>
                Campaign CoW
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 112px",
                gap: 6,
              }}
            >
              <input
                className="field-input"
                placeholder="Entry title (required)"
                value={campLoreTitle}
                disabled={isSavingCampLore || isMutatingLocked}
                onChange={(e) => setCampLoreTitle(e.target.value)}
              />
              <select
                className="field-select"
                value={campLoreCategory}
                disabled={isSavingCampLore || isMutatingLocked}
                onChange={(e) =>
                  setCampLoreCategory(e.target.value as LocationLoreCategory)
                }
              >
                {LOCATION_LORE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat === "secret" ? "🔒 secret" : cat}
                  </option>
                ))}
              </select>
            </div>

            {campLoreCategory === "secret" && (
              <div
                style={{
                  fontSize: "0.68rem",
                  color: "#fda4af",
                  background: "rgba(244, 63, 94, 0.08)",
                  border: "1px solid rgba(244, 63, 94, 0.25)",
                  borderRadius: 5,
                  padding: "5px 7px",
                  lineHeight: 1.35,
                }}
              >
                <strong>Secret Gate:</strong> Withheld from passive context &amp;
                remote recall until unlocked by a trigger keyword or Clean/Critical
                Success discovery roll.
              </div>
            )}

            <textarea
              className="field-textarea"
              rows={3}
              placeholder="Local history, faction presence, rumor, or hidden secret..."
              value={campLoreContent}
              disabled={isSavingCampLore || isMutatingLocked}
              onChange={(e) => setCampLoreContent(e.target.value)}
            />

            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.69rem",
                  color: "var(--text-secondary)",
                  marginBottom: 4,
                }}
              >
                Trigger Keywords (min 1)
              </label>
              <TagChipsInput
                value={campLoreTags}
                onChange={setCampLoreTags}
                onDraftChange={setCampLorePendingTagDraft}
                disabled={isSavingCampLore || isMutatingLocked}
                accentVariant={campLoreCategory === "secret" ? "amber" : "cyan"}
                placeholder="Type keyword & press Enter..."
              />
            </div>

            {campLoreError && (
              <div style={{ fontSize: "0.71rem", color: "#fda4af" }}>
                {campLoreError}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
              <button
                type="button"
                className="btn"
                style={{ padding: "3px 10px", fontSize: "0.73rem" }}
                disabled={isSavingCampLore}
                onClick={() => {
                  setCampLoreFormMode(null);
                  setCampLoreError(null);
                  setCampLorePendingTagDraft("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-cyan"
                style={{ padding: "3px 10px", fontSize: "0.73rem" }}
                disabled={isSavingCampLore || isMutatingLocked}
                onClick={submitCampaignLoreForm}
              >
                {isSavingCampLore ? "Saving..." : "Save Lore"}
              </button>
            </div>
          </div>
        )}

        {loreList.length === 0 ? (
          !campLoreFormMode && (
            <div
              style={{
                fontSize: "0.72rem",
                color: "var(--text-muted)",
                fontStyle: "italic",
              }}
            >
              {emptyText}
            </div>
          )
        ) : mode === "editor" && onEditorUpdate ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {loreList.map((ln, idx) => {
              const isExpanded = expandedEditorLoreId === ln.id;
              const isInvalid =
                !ln.title.trim() ||
                !ln.content.trim() ||
                !ln.entity_tags ||
                ln.entity_tags.length === 0;
              return (
                <div
                  key={ln.id || idx}
                  style={{
                    background: "var(--bg-panel)",
                    border: isInvalid
                      ? "1px solid rgba(244, 63, 94, 0.55)"
                      : "1px solid var(--border-subtle)",
                    borderRadius: 6,
                    padding: "7px 9px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 6,
                      cursor: "pointer",
                    }}
                    onClick={() =>
                      setExpandedEditorLoreId(isExpanded ? null : ln.id)
                    }
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        minWidth: 0,
                        flex: 1,
                      }}
                    >
                      {isExpanded ? (
                        <ChevronDown size={13} />
                      ) : (
                        <ChevronRight size={13} />
                      )}
                      <span
                        className={`lore-cat-badge lore-cat-badge--${ln.category}`}
                      >
                        {ln.category === "secret" && <EyeOff size={10} />}
                        {ln.category}
                      </span>
                      <span
                        style={{
                          fontSize: "0.76rem",
                          fontWeight: 600,
                          color: ln.title.trim()
                            ? "var(--text-primary)"
                            : "#fda4af",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {ln.title.trim() || "Untitled Lore"}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      {isInvalid && (
                        <span
                          title="Requires title, content, and at least 1 keyword"
                          style={{ color: "#fda4af", display: "inline-flex" }}
                        >
                          <AlertCircle size={13} />
                        </span>
                      )}
                      <button
                        type="button"
                        className="item-remove-btn"
                        title="Delete lore entry"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteEditorLore(idx);
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        paddingTop: 4,
                        borderTop: "1px solid var(--border-subtle)",
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 108px",
                          gap: 6,
                        }}
                      >
                        <input
                          className="field-input"
                          placeholder="Lore title (required)"
                          value={ln.title}
                          onChange={(e) =>
                            updateEditorLoreAt(idx, { title: e.target.value })
                          }
                        />
                        <select
                          className="field-select"
                          value={ln.category}
                          onChange={(e) =>
                            updateEditorLoreAt(idx, {
                              category: e.target.value as LocationLoreCategory,
                            })
                          }
                        >
                          {LOCATION_LORE_CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat === "secret" ? "🔒 secret" : cat}
                            </option>
                          ))}
                        </select>
                      </div>

                      <textarea
                        className="field-textarea"
                        rows={3}
                        placeholder="Lore details..."
                        value={ln.content}
                        onChange={(e) =>
                          updateEditorLoreAt(idx, { content: e.target.value })
                        }
                      />

                      <div>
                        <label
                          style={{
                            display: "block",
                            fontSize: "0.68rem",
                            color: "var(--text-secondary)",
                            marginBottom: 3,
                          }}
                        >
                          Trigger Keywords (min 1)
                        </label>
                        <TagChipsInput
                          value={ln.entity_tags || []}
                          onChange={(tags) =>
                            updateEditorLoreAt(idx, { entity_tags: tags })
                          }
                          accentVariant={
                            ln.category === "secret" ? "amber" : "cyan"
                          }
                          placeholder="Type keyword & press Enter..."
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {loreList.map((ln, idx) => (
              <div
                key={ln.id || idx}
                style={{
                  background: "var(--bg-panel)",
                  border:
                    ln.category === "secret"
                      ? "1px solid rgba(244, 63, 94, 0.35)"
                      : "1px solid var(--border-subtle)",
                  borderRadius: 6,
                  padding: "8px 9px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 5,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      minWidth: 0,
                      flex: 1,
                    }}
                  >
                    <span
                      className={`lore-cat-badge lore-cat-badge--${ln.category}`}
                    >
                      {ln.category === "secret" && <EyeOff size={10} />}
                      {ln.category}
                    </span>
                    <span
                      style={{
                        fontSize: "0.76rem",
                        fontWeight: 600,
                        color: "var(--text-primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {ln.title}
                    </span>
                  </div>

                  {onCampaignSave && (
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "2px 5px" }}
                        title="Edit lore"
                        disabled={isMutatingLocked || isSavingCampLore}
                        onClick={() => openCampaignEditLore(idx)}
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        type="button"
                        className="item-remove-btn"
                        title="Delete lore"
                        disabled={isMutatingLocked || isSavingCampLore}
                        onClick={() => handleDeleteCampaignLore(idx)}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )}
                </div>

                <div
                  style={{
                    fontSize: "0.73rem",
                    color: "var(--text-secondary)",
                    lineHeight: 1.42,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {ln.content}
                </div>

                {ln.entity_tags?.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 4,
                      marginTop: 2,
                    }}
                  >
                    {ln.entity_tags.map((tag, tIdx) => (
                      <span
                        key={`${tag}-${tIdx}`}
                        className={`tag-chip-pill ${
                          ln.category === "secret" ? "tag-chip-pill--amber" : ""
                        }`}
                        style={{ padding: "1px 7px", fontSize: "0.66rem" }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        width: "100%",
        height: "100%",
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Header Toolbar */}
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
            `Full Spatial Topology (${locations.length} Locations, ${edges.length} Passages)`}
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
            onClick={() => setZoom((z) => Math.max(0.35, +(z - 0.25).toFixed(2)))}
            title="Zoom Out"
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            className="btn"
            style={{ padding: "4px 9px", fontSize: "0.74rem" }}
            onClick={handleCenter}
            title="Center on Selected / Starting Location"
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
              title="Re-imagine spatial map layout with AI based on your description"
            >
              <Sparkles size={13} />
              Re-imagine Map
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="btn"
              style={{ padding: "4px 8px" }}
              onClick={onClose}
              title="Close Map"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Container Breadcrumb Navigation Bar */}
      {containers.length > 0 && (
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
          <Layers size={13} color="var(--accent-cyan)" />
          <button
            type="button"
            className="btn"
            style={{
              padding: "2px 8px",
              fontSize: "0.72rem",
              fontWeight: currentContainerId === null ? 700 : 500,
              color:
                currentContainerId === null
                  ? "var(--accent-cyan)"
                  : "var(--text-secondary)",
              borderColor:
                currentContainerId === null
                  ? "rgba(6, 182, 212, 0.45)"
                  : undefined,
            }}
            onClick={() => drillIntoContainer(null)}
          >
            World Root
          </button>
          {projectedTopology.breadcrumbs.map((crumb) => {
            const isLeaf = crumb.id === currentContainerId;
            return (
              <React.Fragment key={crumb.id}>
                <ChevronRight size={12} color="var(--text-muted)" />
                <button
                  type="button"
                  className="btn"
                  style={{
                    padding: "2px 8px",
                    fontSize: "0.72rem",
                    fontWeight: isLeaf ? 700 : 500,
                    color: isLeaf ? "var(--accent-cyan)" : "var(--text-secondary)",
                    borderColor: isLeaf ? "rgba(6, 182, 212, 0.45)" : undefined,
                  }}
                  onClick={() => drillIntoContainer(crumb.id)}
                >
                  <FolderOpen size={11} />
                  {crumb.name}
                  <span style={{ opacity: 0.65, fontSize: "0.65rem" }}>
                    (L{crumb.depth})
                  </span>
                </button>
              </React.Fragment>
            );
          })}
          {currentContainerId !== null && (
            <button
              type="button"
              className="btn"
              style={{
                marginLeft: "auto",
                padding: "2px 8px",
                fontSize: "0.7rem",
              }}
              onClick={() =>
                drillIntoContainer(
                  projectedTopology.currentContainer?.parent_container_id ?? null
                )
              }
            >
              ↑ Up One Level
            </button>
          )}
        </div>
      )}

      {/* Main 2-Column Area: SVG Visual Map + Selected Location Inspector */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 375px)",
          gridTemplateRows: "minmax(0, 1fr)",
          gap: 14,
          flex: 1,
          minHeight: 400,
          height: "calc(90vh - 120px)",
          maxHeight: "100%",
          overflow: "hidden",
        }}
      >
        {/* Left: Interactive Pan/Zoom SVG Canvas */}
        <div
          style={{
            position: "relative",
            background: "var(--bg-deep)",
            borderRadius: 8,
            border: "1px solid var(--border-subtle)",
            overflow: "hidden",
            userSelect: "none",
            height: "100%",
            minHeight: 0,
          }}
        >
          <svg
            width="100%"
            height="100%"
            style={{
              width: "100%",
              height: "100%",
              minHeight: 0,
              cursor: dragRef.current.dragging ? "grabbing" : "grab",
              display: "block",
            }}
            viewBox="-340 -260 680 520"
            onWheel={(e) => {
              e.preventDefault();
              const delta = e.deltaY < 0 ? 0.15 : -0.15;
              setZoom((z) =>
                Math.min(3, Math.max(0.35, +(z + delta).toFixed(2)))
              );
            }}
            onMouseDown={(e) => {
              dragRef.current = {
                dragging: true,
                startX: e.clientX,
                startY: e.clientY,
                origX: pan.x,
                origY: pan.y,
              };
            }}
            onMouseMove={(e) => {
              if (!dragRef.current.dragging) return;
              const dx = (e.clientX - dragRef.current.startX) / zoom;
              const dy = (e.clientY - dragRef.current.startY) / zoom;
              setPan({
                x: dragRef.current.origX + dx,
                y: dragRef.current.origY + dy,
              });
            }}
            onMouseUp={() => {
              dragRef.current.dragging = false;
            }}
            onMouseLeave={() => {
              dragRef.current.dragging = false;
            }}
          >
            <g transform={`scale(${zoom}) translate(${pan.x}, ${pan.y})`}>
              {/* Projected Edge Passages */}
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
                          : 1.4
                      }
                      strokeDasharray={
                        edge.containsLockedEdge
                          ? "5 4"
                          : edge.isAggregated
                          ? "2 2"
                          : undefined
                      }
                    />
                    {edge.compass_direction &&
                      edge.sourceNodeId < edge.targetNodeId && (
                        <text
                          x={midX}
                          y={midY - 5}
                          textAnchor="middle"
                          fill={isDirect ? "#67e8f9" : "#64748b"}
                          fontSize="8.5"
                          fontWeight="600"
                        >
                          {edge.compass_direction} ({edge.travel_minutes}m)
                          {edge.isAggregated ? " ⇄" : ""}
                        </text>
                      )}
                  </g>
                );
              })}

              {/* Projected Child Container Supernodes */}
              {projectedTopology.visibleSupernodes.map((sn) => {
                const pt = fullMapCoords[sn.container.id];
                if (!pt) return null;
                const isSelected = selectedContainer?.id === sn.container.id;
                const cardW = 136;
                const cardH = 44;
                return (
                  <g
                    key={sn.container.id}
                    style={{ cursor: "pointer" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      selectContainerNode(sn.container.id);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      drillIntoContainer(sn.container.id);
                    }}
                  >
                    <rect
                      x={pt.x - cardW / 2 - 4}
                      y={pt.y - cardH / 2 - 4}
                      width={cardW + 8}
                      height={cardH + 8}
                      rx={10}
                      fill="none"
                      stroke={
                        sn.hasActivePlayer
                          ? "#f59e0b"
                          : isSelected
                          ? "#38bdf8"
                          : "transparent"
                      }
                      strokeWidth={sn.hasActivePlayer || isSelected ? 2 : 0}
                      strokeDasharray={
                        sn.hasActivePlayer ? "4 3" : isSelected ? "3 3" : undefined
                      }
                    />
                    <rect
                      x={pt.x - cardW / 2}
                      y={pt.y - cardH / 2}
                      width={cardW}
                      height={cardH}
                      rx={7}
                      fill="#162033"
                      stroke={
                        sn.hasActivePlayer
                          ? "#f59e0b"
                          : isSelected
                          ? "#22d3ee"
                          : "#475569"
                      }
                      strokeWidth={1.6}
                    />
                    <text
                      x={pt.x}
                      y={pt.y - 4}
                      textAnchor="middle"
                      fill={sn.hasActivePlayer ? "#fbbf24" : "#e2e8f0"}
                      fontSize="10.2"
                      fontWeight="700"
                    >
                      {sn.container.name.length > 18
                        ? `${sn.container.name.slice(0, 17)}…`
                        : sn.container.name}
                    </text>
                    <text
                      x={pt.x}
                      y={pt.y + 11}
                      textAnchor="middle"
                      fill="#94a3b8"
                      fontSize="8.3"
                    >
                      L{sn.container.depth} · {sn.descendantLocationCount} rooms ·{" "}
                      {sn.externalPortalsCount} portals
                    </text>
                  </g>
                );
              })}

              {/* Visible Direct Location Nodes */}
              {projectedTopology.visibleLocations.map((loc) => {
                const pt = fullMapCoords[loc.id];
                if (!pt) return null;
                const isAnchor = loc.id === activeLoc?.id;
                const isNeighbor = activeNeighborIds.has(loc.id);
                const isSelected =
                  !selectedContainer && loc.id === selectedLocation?.id;
                const isPortal = projectedTopology.dynamicPortalIds.has(loc.id);
                const extExits =
                  projectedTopology.externalPortalsByLocationId[loc.id] ?? [];
                const fill = isAnchor
                  ? "#f59e0b"
                  : loc.is_hub
                  ? "#a855f7"
                  : isNeighbor
                  ? "#06b6d4"
                  : "#475569";

                return (
                  <g
                    key={loc.id}
                    style={{ cursor: "pointer" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      selectLocationNode(loc.id);
                    }}
                  >
                    {isSelected && (
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={isAnchor ? 16 : 13}
                        fill="none"
                        stroke={isAnchor ? "#fbbf24" : "#38bdf8"}
                        strokeWidth={2}
                        strokeDasharray="3 3"
                      />
                    )}
                    {isPortal && (
                      <polygon
                        points={`${pt.x},${pt.y - 13} ${pt.x + 13},${pt.y} ${pt.x},${pt.y + 13} ${pt.x - 13},${pt.y}`}
                        fill="none"
                        stroke="#22d3ee"
                        strokeWidth={1.3}
                      />
                    )}
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isAnchor ? 11 : loc.is_hub ? 9.5 : 8}
                      fill={fill}
                      stroke="#0b0e14"
                      strokeWidth={2.2}
                    />
                    <text
                      x={pt.x}
                      y={pt.y + (isAnchor ? 23 : 19)}
                      textAnchor="middle"
                      fill={
                        isAnchor
                          ? "#fbbf24"
                          : isSelected
                          ? "#f8fafc"
                          : "#cbd5e1"
                      }
                      fontSize="10.5"
                      fontWeight={isAnchor || isSelected ? "700" : "500"}
                    >
                      {loc.name}
                    </text>
                    {extExits.length > 0 && (
                      <text
                        x={pt.x}
                        y={pt.y + (isAnchor ? 34 : 30)}
                        textAnchor="middle"
                        fill="#22d3ee"
                        fontSize="8.2"
                      >
                        ↗ External: {extExits[0].destination.name}
                        {extExits.length > 1 ? ` +${extExits.length - 1}` : ""}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>

          {/* Portal Promotion Confirmation Modal */}
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
                zIndex: 25,
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
                          candidates: buildPromotionCandidates(
                            promotionPrompt.fromLocation,
                            picked
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
                      Entry/Exit Portals so AI exploration can step outside cleanly:
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
                  {promotionPrompt.candidates.length > 0 && (
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "4px 10px", fontSize: "0.74rem" }}
                      onClick={() =>
                        executeEdgeCreation(
                          promotionPrompt.fromLocation,
                          promotionPrompt.toLocation,
                          promotionPrompt.direction,
                          promotionPrompt.travelMinutes,
                          promotionPrompt.bidirectional,
                          new Set()
                        )
                      }
                    >
                      Connect Without Promoting
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-cyan"
                    style={{ padding: "4px 12px", fontSize: "0.74rem" }}
                    onClick={() =>
                      executeEdgeCreation(
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

          {/* Floating Legend Overlay */}
          <div
            style={{
              position: "absolute",
              left: 10,
              bottom: 10,
              background: "rgba(11, 14, 20, 0.88)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 6,
              padding: "5px 10px",
              fontSize: "0.7rem",
              color: "var(--text-secondary)",
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <span>
              <strong style={{ color: "#f59e0b" }}>●</strong>{" "}
              {mode === "campaign" ? "Current Scene" : "Starting Hub"}
            </span>
            <span>
              <strong style={{ color: "#a855f7" }}>●</strong> Passage Hub
            </span>
            <span>
              <strong style={{ color: "#06b6d4" }}>●</strong> Adjacent
            </span>
            <span>
              <strong style={{ color: "#475569" }}>●</strong> Other Rooms
            </span>
            <span style={{ color: "var(--text-muted)", fontSize: "0.68rem" }}>
              (Drag to pan • Wheel to zoom • Click node to select)
            </span>
          </div>
        </div>

        {/* Right: Selected Location Inspector & Editor Controls */}
        <div
          ref={inspectorScrollRef}
          style={{
            background: "var(--bg-card)",
            borderRadius: 8,
            border: "1px solid var(--border-subtle)",
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            overflowY: "auto",
            minHeight: 0,
            height: "100%",
            maxHeight: "100%",
          }}
        >
          {/* Right Inspector Content: Container Supernode OR Location Node */}
          {selectedContainer ? (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 4,
                }}
              >
                <div
                  style={{
                    fontSize: "0.68rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--accent-cyan)",
                    fontWeight: 600,
                  }}
                >
                  Level {selectedContainer.depth} ·{" "}
                  {CONTAINER_DEPTH_LABELS[selectedContainer.depth]}
                </div>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "2px 7px", fontSize: "0.68rem" }}
                  onClick={() => setSelectedContainerId(null)}
                >
                  <X size={11} />
                </button>
              </div>

              {mode === "editor" && onUpdateContainer ? (
                <div className="field-group" style={{ marginBottom: 4 }}>
                  <label style={{ fontSize: "0.72rem" }}>Container Name</label>
                  <input
                    className="field-input"
                    value={selectedContainer.name}
                    onChange={(e) =>
                      onUpdateContainer({
                        ...selectedContainer,
                        name: e.target.value,
                      })
                    }
                  />
                </div>
              ) : (
                <div
                  style={{
                    fontSize: "0.98rem",
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <FolderOpen size={16} color="var(--accent-cyan)" />
                  {selectedContainer.name}
                </div>
              )}

              <button
                type="button"
                className="btn btn-cyan"
                style={{
                  width: "100%",
                  justifyContent: "center",
                  padding: "7px 12px",
                  fontSize: "0.78rem",
                }}
                onClick={() => drillIntoContainer(selectedContainer.id)}
              >
                <LogIn size={13} />
                Enter Container ➔
              </button>

              {(() => {
                const supStats = projectedTopology.visibleSupernodes.find(
                  (s) => s.container.id === selectedContainer.id
                );
                if (!supStats) return null;
                return (
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      fontSize: "0.72rem",
                      color: "var(--text-secondary)",
                      background: "var(--bg-panel)",
                      padding: "6px 9px",
                      borderRadius: 6,
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    <span>
                      Rooms inside:{" "}
                      <strong>{supStats.descendantLocationCount}</strong>
                    </span>
                    <span>·</span>
                    <span>
                      Entry/Exit Portals:{" "}
                      <strong>{supStats.externalPortalsCount}</strong>
                    </span>
                    {supStats.hasActivePlayer && (
                      <span style={{ color: "var(--accent-amber)", fontWeight: 600 }}>
                        · Party Present
                      </span>
                    )}
                  </div>
                );
              })()}

              {mode === "editor" && onUpdateContainer ? (
                <>
                  <div className="field-group">
                    <label style={{ fontSize: "0.72rem" }}>
                      Atmospheric Description
                    </label>
                    <textarea
                      className="field-textarea"
                      rows={3}
                      value={selectedContainer.description}
                      onChange={(e) =>
                        onUpdateContainer({
                          ...selectedContainer,
                          description: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label style={{ fontSize: "0.72rem" }}>
                      Environmental Tags
                    </label>
                    <TagChipsInput
                      value={selectedContainer.environmental_tags || []}
                      placeholder="e.g. humid, bass, neon..."
                      accentVariant="cyan"
                      onChange={(tags) =>
                        onUpdateContainer({
                          ...selectedContainer,
                          environmental_tags: tags,
                        })
                      }
                    />
                  </div>
                </>
              ) : (
                <>
                  {selectedContainer.description && (
                    <div className="cog-step">
                      <div className="cog-step-label">Atmosphere</div>
                      <div style={{ fontSize: "0.76rem", lineHeight: 1.45 }}>
                        {selectedContainer.description}
                      </div>
                    </div>
                  )}
                  {selectedContainer.environmental_tags?.length > 0 && (
                    <div className="cog-step">
                      <div className="cog-step-label">Environmental Tags</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {selectedContainer.environmental_tags.map((t, i) => (
                          <span
                            key={i}
                            className="badge"
                            style={{ fontSize: "0.68rem", padding: "2px 6px" }}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {selectedContainer.depth === 1 ? (
                renderScopedLoreSection({
                  targetId: selectedContainer.id,
                  targetName: selectedContainer.name,
                  worldId: selectedContainer.world_id,
                  scopeLabel: "Container Lore & Secrets",
                  emptyText:
                    "No Level 1 container lore attached to this building/landmark.",
                  loreList: selectedContainer.lore_nodes ?? [],
                  onEditorUpdate: onUpdateContainer
                    ? (nextLore) =>
                        onUpdateContainer({
                          ...selectedContainer,
                          lore_nodes: nextLore,
                        })
                    : undefined,
                  onCampaignSave: onSaveCampaignContainerLore,
                })
              ) : (
                <div
                  style={{
                    fontSize: "0.71rem",
                    color: "var(--text-muted)",
                    borderTop: "1px solid var(--border-subtle)",
                    paddingTop: 8,
                    fontStyle: "italic",
                  }}
                >
                  Level {selectedContainer.depth} macro containers store sensory
                  breadcrumbs only; ambient lore attaches to Level 1 landmarks and
                  World Lore.
                </div>
              )}
            </>
          ) : (
            <>
          {/* Header Row */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  fontSize: "0.68rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                }}
              >
                Selected Location
              </div>

              {/* Editor Mode: Delete Location button */}
              {mode === "editor" &&
                onDeleteLocation &&
                locations.length > 1 && (
                  <button
                    type="button"
                    className="item-remove-btn"
                    title="Delete this location and connected exits"
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete "${selectedLocation.name}" and all connecting passages?`
                        )
                      ) {
                        onDeleteLocation(selectedLocation.id);
                      }
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
            </div>

            {/* Location Title / Name Input */}
            {mode === "editor" && onUpdateLocation ? (
              <div className="field-group" style={{ marginBottom: 6 }}>
                <label style={{ fontSize: "0.72rem" }}>Location Name</label>
                <input
                  className="field-input"
                  style={{
                    fontWeight: 700,
                    fontSize: "0.9rem",
                    color: isCurrentOrStart
                      ? "var(--accent-amber)"
                      : "var(--text-primary)",
                  }}
                  value={selectedLocation.name}
                  onChange={(e) =>
                    onUpdateLocation({
                      ...selectedLocation,
                      name: e.target.value,
                    })
                  }
                />
              </div>
            ) : (
              <div
                style={{
                  fontSize: "0.98rem",
                  fontWeight: 700,
                  color: isCurrentOrStart
                    ? "var(--accent-amber)"
                    : "var(--text-primary)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  flexWrap: "wrap",
                }}
              >
                <MapPin size={15} color="var(--accent-cyan)" />
                {selectedLocation.name}
                {selectedLocation.is_hub && (
                  <span
                    className="badge"
                    style={{
                      fontSize: "0.62rem",
                      padding: "1px 6px",
                      color: "#c084fc",
                      borderColor: "rgba(168, 85, 247, 0.4)",
                    }}
                  >
                    PASSAGE HUB
                  </span>
                )}
                {projectedTopology.dynamicPortalIds.has(
                  selectedLocation.id
                ) && (
                  <span
                    className="badge"
                    style={{
                      fontSize: "0.62rem",
                      padding: "1px 6px",
                      color: "var(--accent-cyan)",
                      borderColor: "rgba(6, 182, 212, 0.45)",
                    }}
                  >
                    [Entry/Exit Portal]
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Container Membership & External Portal Info */}
          {(containers.length > 0 ||
            (mode === "editor" && onConvertToContainer)) && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                background: "var(--bg-panel)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 6,
                padding: "7px 9px",
                fontSize: "0.73rem",
              }}
            >
              {mode === "editor" && onUpdateLocation ? (
                <div className="field-group" style={{ gap: 3 }}>
                  <label style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                    Assigned Container (Levels 1–4)
                  </label>
                  <select
                    className="field-select"
                    style={{ fontSize: "0.74rem", padding: "4px 6px" }}
                    value={selectedLocation.container_id ?? ""}
                    onChange={(e) => {
                      const nextCid = e.target.value || null;
                      onUpdateLocation({
                        ...selectedLocation,
                        container_id: nextCid,
                        is_entry_exit: nextCid
                          ? selectedLocation.is_entry_exit
                          : false,
                      });
                    }}
                  >
                    <option value="">World Root (Uncontained)</option>
                    {containers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} (L{c.depth} · {CONTAINER_DEPTH_LABELS[c.depth]})
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                selectedLocation.container_id && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 6,
                    }}
                  >
                    <span style={{ color: "var(--text-secondary)" }}>
                      Container:{" "}
                      <strong>
                        {containerMap.get(selectedLocation.container_id)?.name ||
                          selectedLocation.container_id}
                      </strong>
                    </span>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "1px 7px", fontSize: "0.68rem" }}
                      onClick={() =>
                        selectContainerNode(selectedLocation.container_id!)
                      }
                    >
                      Inspect Container
                    </button>
                  </div>
                )
              )}

              {(projectedTopology.externalPortalsByLocationId[selectedLocation.id]
                ?.length ?? 0) > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 4,
                    marginTop: 2,
                  }}
                >
                  {projectedTopology.externalPortalsByLocationId[
                    selectedLocation.id
                  ].map((ext) => (
                    <span
                      key={ext.edge.id}
                      className="badge"
                      style={{
                        fontSize: "0.66rem",
                        padding: "1px 6px",
                        color: "#22d3ee",
                        borderColor: "rgba(34, 211, 238, 0.4)",
                      }}
                    >
                      External Exit → {ext.destination.name} (
                      {ext.destinationContainerName})
                    </span>
                  ))}
                </div>
              )}

              {mode === "editor" && onConvertToContainer && (
                <button
                  type="button"
                  className="btn"
                  style={{
                    justifyContent: "center",
                    padding: "4px 8px",
                    fontSize: "0.72rem",
                    color: "var(--accent-amber)",
                  }}
                  onClick={() => onConvertToContainer(selectedLocation)}
                  title="Promote this Level 0 location into a Level 1 container with an initial interior portal room"
                >
                  <FolderOpen size={12} />
                  Convert to Container
                </button>
              )}
            </div>
          )}

          {/* Location Role & Starting Location Status */}
          {mode === "campaign" ? (
            isCurrentOrStart ? (
              <div
                style={{
                  background: "rgba(245, 158, 11, 0.12)",
                  border: "1px solid rgba(245, 158, 11, 0.35)",
                  borderRadius: 6,
                  padding: "6px 10px",
                  fontSize: "0.74rem",
                  color: "var(--accent-amber)",
                  fontWeight: 600,
                }}
              >
                Active Scene Location
              </div>
            ) : (
              onOverrideLocation && (
                <button
                  type="button"
                  className="btn btn-amber"
                  style={{
                    width: "100%",
                    justifyContent: "center",
                    padding: "7px 12px",
                    fontSize: "0.78rem",
                  }}
                  disabled={isOverriding}
                  onClick={() => onOverrideLocation(selectedLocation.id)}
                >
                  <Navigation size={13} />
                  {isOverriding
                    ? "Overriding Location..."
                    : "Override Current Location Here"}
                </button>
              )
            )
          ) : (
            /* Editor Mode: Hub toggle + Starting Hub designation */
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                background: "var(--bg-panel)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 6,
                padding: "8px 10px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {selectedLocation.is_starting_location ? (
                  <span
                    className="badge"
                    style={{
                      color: "var(--accent-amber)",
                      borderColor: "rgba(245, 158, 11, 0.4)",
                      fontSize: "0.72rem",
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Star size={11} fill="var(--accent-amber)" /> Starting Hub
                  </span>
                ) : (
                  onSetStartingLocation && (
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                      onClick={() =>
                        onSetStartingLocation(selectedLocation.id)
                      }
                      title="Set as initial starting location for campaigns"
                    >
                      <Star size={12} /> Set as Starting Hub
                    </button>
                  )
                )}

                {/* Passage Hub & Entry/Exit Portal Toggles */}
                {onUpdateLocation && (
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: "0.73rem",
                        cursor: "pointer",
                        color: selectedLocation.is_hub
                          ? "#c084fc"
                          : "var(--text-secondary)",
                        fontWeight: selectedLocation.is_hub ? 600 : 400,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(selectedLocation.is_hub)}
                        onChange={(e) =>
                          onUpdateLocation({
                            ...selectedLocation,
                            is_hub: e.target.checked,
                          })
                        }
                      />
                      Passage Hub
                    </label>
                    {selectedLocation.container_id && (
                      <label
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          fontSize: "0.73rem",
                          cursor: "pointer",
                          color: selectedLocation.is_entry_exit
                            ? "var(--accent-cyan)"
                            : "var(--text-secondary)",
                          fontWeight: selectedLocation.is_entry_exit ? 600 : 400,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(selectedLocation.is_entry_exit)}
                          onChange={(e) =>
                            onUpdateLocation({
                              ...selectedLocation,
                              is_entry_exit: e.target.checked,
                            })
                          }
                        />
                        Entry/Exit Portal
                      </label>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Summary / Exit Hook */}
          {mode === "editor" && onUpdateLocation ? (
            <div className="field-group">
              <label style={{ fontSize: "0.72rem" }}>
                1-Sentence Exit Hook / Summary
              </label>
              <input
                className="field-input"
                value={selectedLocation.summary || ""}
                placeholder="Brief summary visible from adjacent rooms..."
                onChange={(e) =>
                  onUpdateLocation({
                    ...selectedLocation,
                    summary: e.target.value,
                  })
                }
              />
            </div>
          ) : (
            selectedLocation.summary && (
              <div
                style={{
                  fontSize: "0.76rem",
                  color: "var(--accent-cyan)",
                  lineHeight: 1.4,
                }}
              >
                {selectedLocation.summary}
              </div>
            )
          )}

          {/* Sensory Description */}
          {mode === "editor" && onUpdateLocation ? (
            <div className="field-group">
              <label style={{ fontSize: "0.72rem" }}>
                Sensory Description (Atmosphere, Sights, Smells)
              </label>
              <textarea
                className="field-textarea"
                rows={3}
                value={selectedLocation.description}
                placeholder="Full sensory description when inside this room..."
                onChange={(e) =>
                  onUpdateLocation({
                    ...selectedLocation,
                    description: e.target.value,
                  })
                }
              />
            </div>
          ) : (
            <div className="cog-step">
              <div className="cog-step-label">Sensory Description</div>
              <div style={{ fontSize: "0.76rem", lineHeight: 1.45 }}>
                {selectedLocation.description}
              </div>
            </div>
          )}

          {/* Starting Message / Turn 0 Atmosphere */}
          {mode === "editor" && onUpdateLocation ? (
            <div className="field-group">
              <label
                style={{
                  fontSize: "0.72rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span>Starting Message (Turn 0 Atmosphere)</span>
                {selectedLocation.is_starting_location && (
                  <span
                    className="badge"
                    style={{
                      fontSize: "0.64rem",
                      background: "rgba(16, 185, 129, 0.15)",
                      color: "var(--accent-emerald)",
                      border: "1px solid rgba(16, 185, 129, 0.4)",
                    }}
                  >
                    Primary Starting Location
                  </span>
                )}
              </label>
              <textarea
                className="field-textarea"
                rows={3}
                value={selectedLocation.starting_message ?? ""}
                placeholder="Atmospheric opening prose used if campaigns start in this room..."
                onChange={(e) =>
                  onUpdateLocation({
                    ...selectedLocation,
                    starting_message: e.target.value,
                  })
                }
              />
            </div>
          ) : selectedLocation.starting_message ? (
            <div className="cog-step">
              <div className="cog-step-label">
                Starting Message (Turn 0 Atmosphere)
              </div>
              <div
                style={{
                  fontSize: "0.76rem",
                  lineHeight: 1.45,
                  fontStyle: "italic",
                  color: "var(--text-secondary)",
                }}
              >
                {selectedLocation.starting_message}
              </div>
            </div>
          ) : null}

          {/* Environmental Tags */}
          {mode === "editor" && onUpdateLocation ? (
            <div className="field-group">
              <label style={{ fontSize: "0.72rem" }}>
                Environmental Tags
              </label>
              <TagChipsInput
                value={selectedLocation.environmental_tags}
                placeholder="e.g. dim, noisy, neon, smoke (press comma or enter)"
                accentVariant="cyan"
                onChange={(tags) =>
                  onUpdateLocation({
                    ...selectedLocation,
                    environmental_tags: tags,
                  })
                }
              />
            </div>
          ) : (
            selectedLocation.environmental_tags.length > 0 && (
              <div className="cog-step">
                <div className="cog-step-label">Environmental Tags</div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 4,
                    marginTop: 4,
                  }}
                >
                  {selectedLocation.environmental_tags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="badge"
                      style={{ fontSize: "0.68rem", padding: "2px 6px" }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )
          )}

          {/* Location Lore & Secrets */}
          {renderScopedLoreSection({
            targetId: selectedLocation.id,
            targetName: selectedLocation.name,
            worldId: selectedLocation.world_id,
            scopeLabel: "Location Lore & Secrets",
            emptyText: "No local lore attached to this room.",
            loreList: selectedLocation.lore_nodes ?? [],
            onEditorUpdate: onUpdateLocation
              ? (nextLore) =>
                  onUpdateLocation({
                    ...selectedLocation,
                    lore_nodes: nextLore,
                  })
              : undefined,
            onCampaignSave: onSaveCampaignLocationLore,
          })}

          {/* Action: Create Linked Location from Selected Location */}
          {onCreateLinkedLocation && (
            <div>
              {!showLinkForm && !showConnectForm ? (
                mode === "editor" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <button
                      type="button"
                      className="btn"
                      style={{
                        width: "100%",
                        justifyContent: "center",
                        padding: "7px 12px",
                        fontSize: "0.78rem",
                      }}
                      onClick={() => openLinkForm(false)}
                    >
                      <Link2 size={13} />
                      Create Link from {selectedLocation.name}
                    </button>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                      <button
                        type="button"
                        className="btn"
                        style={{
                          justifyContent: "center",
                          padding: "5px 8px",
                          fontSize: "0.72rem",
                          color: "#c084fc",
                        }}
                        onClick={() => openLinkForm(true)}
                        title="Add a connected transit corridor or junction"
                      >
                        <GitBranch size={12} />
                        + Passage Hub
                      </button>

                      {locations.length >= 2 && onAddEdge && (
                        <button
                          type="button"
                          className="btn"
                          style={{
                            justifyContent: "center",
                            padding: "5px 8px",
                            fontSize: "0.72rem",
                          }}
                          onClick={openConnectForm}
                          title="Connect this room to an existing location"
                        >
                          <Plus size={12} />
                          + Exit to Room
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {locations.length >= 2 && onAddEdge ? (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{
                            justifyContent: "center",
                            padding: "6px 8px",
                            fontSize: "0.74rem",
                          }}
                          onClick={() => openLinkForm(false)}
                          title="Explore and map a new adjacent room"
                        >
                          <Link2 size={12} />
                          + New Room
                        </button>

                        <button
                          type="button"
                          className="btn btn-cyan"
                          style={{
                            justifyContent: "center",
                            padding: "6px 8px",
                            fontSize: "0.74rem",
                          }}
                          onClick={openConnectForm}
                          title="Connect this room to an existing location"
                        >
                          <Plus size={12} />
                          + Connect Room
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{
                          width: "100%",
                          justifyContent: "center",
                          padding: "7px 12px",
                          fontSize: "0.78rem",
                        }}
                        onClick={() => openLinkForm(false)}
                        title="Explore and map an adjacent room"
                      >
                        <Link2 size={13} />
                        Create Link from {selectedLocation.name}
                      </button>
                    )}
                  </div>
                )
              ) : showLinkForm ? (
                /* Link Creation Form */
                <div
                  ref={linkFormRef}
                  style={{
                    border: "1px solid rgba(6, 182, 212, 0.45)",
                    borderRadius: 6,
                    padding: 10,
                    display: "flex",
                    flexDirection: "column",
                    gap: 7,
                    background: "var(--bg-panel)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span className="cog-step-label">
                      New {linkIsHub ? "Passage Hub" : "Room"} linked to{" "}
                      {selectedLocation.name}
                    </span>
                    {mode === "editor" && (
                      <label
                        style={{
                          fontSize: "0.7rem",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          cursor: "pointer",
                          color: linkIsHub ? "#c084fc" : "var(--text-secondary)",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={linkIsHub}
                          onChange={(e) => setLinkIsHub(e.target.checked)}
                        />
                        Passage Hub
                      </label>
                    )}
                  </div>

                  <input
                    className="field-input"
                    placeholder="Name of the new location"
                    value={linkName}
                    onChange={(e) => setLinkName(e.target.value)}
                  />

                  <div style={{ display: "flex", gap: 6 }}>
                    <select
                      className="field-input"
                      style={{ flex: 1 }}
                      value={linkDirection}
                      onChange={(e) =>
                        setLinkDirection(e.target.value as CompassDirection)
                      }
                      title="Compass direction relative to current room"
                    >
                      {COMPASS_ORDER.map((d) => {
                        const isOcc = occupiedDirections.has(d);
                        return (
                          <option key={d} value={d}>
                            {d} {isOcc ? "(exit taken)" : "(free)"}
                          </option>
                        );
                      })}
                    </select>

                    <input
                      className="field-input"
                      type="number"
                      min={1}
                      max={240}
                      style={{ width: 85 }}
                      value={linkMinutes}
                      onChange={(e) => setLinkMinutes(e.target.value)}
                      title="Travel minutes"
                    />
                    <span
                      style={{
                        fontSize: "0.7rem",
                        color: "var(--text-muted)",
                        alignSelf: "center",
                      }}
                    >
                      min
                    </span>
                  </div>

                  <textarea
                    className="field-textarea"
                    rows={3}
                    placeholder="Sensory description of the new room..."
                    value={linkDescription}
                    onChange={(e) => setLinkDescription(e.target.value)}
                  />

                  <input
                    className="field-input"
                    placeholder="Environmental tags (comma separated)"
                    value={linkTags}
                    onChange={(e) => setLinkTags(e.target.value)}
                  />

                  {linkError && (
                    <div style={{ fontSize: "0.72rem", color: "#fda4af" }}>
                      {linkError}
                    </div>
                  )}

                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      justifyContent: "flex-end",
                      marginTop: 2,
                    }}
                  >
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "3px 10px", fontSize: "0.74rem" }}
                      onClick={() => setShowLinkForm(false)}
                      disabled={isCreatingLink}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-amber"
                      style={{ padding: "3px 10px", fontSize: "0.74rem" }}
                      onClick={submitLinkForm}
                      disabled={
                        isCreatingLink ||
                        !linkName.trim() ||
                        !linkDescription.trim()
                      }
                    >
                      {isCreatingLink ? "Creating..." : "Create Link"}
                    </button>
                  </div>
                </div>
              ) : (
                /* Connect to Existing Room Form (Editor mode) */
                <div
                  ref={connectFormRef}
                  style={{
                    border: "1px solid rgba(168, 85, 247, 0.45)",
                    borderRadius: 6,
                    padding: 10,
                    display: "flex",
                    flexDirection: "column",
                    gap: 7,
                    background: "var(--bg-panel)",
                  }}
                >
                  <div className="cog-step-label">
                    Connect {selectedLocation.name} to Existing Room
                  </div>

                  <select
                    className="field-select"
                    value={connectTargetId}
                    onChange={(e) => setConnectTargetId(e.target.value)}
                  >
                    <optgroup label="Locations">
                      {locations
                        .filter((l) => l.id !== selectedLocation.id)
                        .map((l) => {
                          const isAlreadyConnected = selectedLocExits.some(
                            (ex) => ex.dest.id === l.id
                          );
                          return (
                            <option
                              key={l.id}
                              value={l.id}
                              disabled={isAlreadyConnected}
                            >
                              {l.name} {l.is_hub ? "(Hub)" : ""}{" "}
                              {projectedTopology.dynamicPortalIds.has(l.id)
                                ? "[Portal] "
                                : ""}
                              {isAlreadyConnected ? "(already connected)" : ""}
                            </option>
                          );
                        })}
                    </optgroup>
                    {projectedTopology.visibleSupernodes.length > 0 && (
                      <optgroup label="Containers (Supernodes)">
                        {projectedTopology.visibleSupernodes.map((sn) => (
                          <option
                            key={`cont:${sn.container.id}`}
                            value={`cont:${sn.container.id}`}
                          >
                            [Container] {sn.container.name} (
                            {sn.descendantLocationCount} rooms,{" "}
                            {sn.externalPortalsCount} portals)
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>

                  <div style={{ display: "flex", gap: 6 }}>
                    <select
                      className="field-input"
                      style={{ flex: 1 }}
                      value={connectDirection}
                      onChange={(e) =>
                        setConnectDirection(e.target.value as CompassDirection)
                      }
                    >
                      {COMPASS_ORDER.map((d) => (
                        <option key={d} value={d}>
                          {d} {occupiedDirections.has(d) ? "(exit taken)" : ""}
                        </option>
                      ))}
                    </select>

                    <input
                      className="field-input"
                      type="number"
                      min={1}
                      max={240}
                      style={{ width: 85 }}
                      value={connectMinutes}
                      onChange={(e) => setConnectMinutes(e.target.value)}
                    />
                    <span
                      style={{
                        fontSize: "0.7rem",
                        color: "var(--text-muted)",
                        alignSelf: "center",
                      }}
                    >
                      min
                    </span>
                  </div>

                  <label
                    style={{
                      fontSize: "0.72rem",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      color: "var(--text-secondary)",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={connectBidirectional}
                      onChange={(e) =>
                        setConnectBidirectional(e.target.checked)
                      }
                    />
                    Create reciprocal return exit automatically
                  </label>

                  {connectError && (
                    <div style={{ fontSize: "0.72rem", color: "#fda4af" }}>
                      {connectError}
                    </div>
                  )}

                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      justifyContent: "flex-end",
                    }}
                  >
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "3px 10px", fontSize: "0.74rem" }}
                      onClick={() => setShowConnectForm(false)}
                      disabled={isConnecting}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn btn-cyan"
                      style={{ padding: "3px 10px", fontSize: "0.74rem" }}
                      onClick={submitConnectForm}
                      disabled={!connectTargetId || isConnecting}
                    >
                      {isConnecting ? "Connecting..." : "Add Connection"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Connected Exits Section */}
          <div>
            <div
              className="cog-step-label"
              style={{
                marginBottom: 6,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>Connected Exits ({selectedLocExits.length}/8)</span>
            </div>

            {selectedLocExits.length === 0 ? (
              <div
                style={{
                  fontSize: "0.72rem",
                  color: "var(--text-muted)",
                  fontStyle: "italic",
                }}
              >
                No exits leading out of this location.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {selectedLocExits.map(({ edge, dest }) => (
                  <div
                    key={edge.id}
                    className="exit-pill"
                    style={{ cursor: "pointer", position: "relative" }}
                    onClick={() => selectLocationNode(dest.id)}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: "0.76rem",
                        fontWeight: 600,
                        color: "#22d3ee",
                      }}
                    >
                      <span>
                        [{edge.compass_direction || "N"}] → {dest.name}
                        {dest.is_hub && (
                          <span
                            style={{
                              marginLeft: 5,
                              color: "#c084fc",
                              fontSize: "0.65rem",
                            }}
                          >
                            (Hub)
                          </span>
                        )}
                      </span>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {editingEdgeId === edge.id ? (
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 3,
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="number"
                              min={1}
                              max={240}
                              value={editMinutes}
                              onChange={(e) => setEditMinutes(e.target.value)}
                              style={{
                                width: 44,
                                padding: "1px 3px",
                                fontSize: "0.7rem",
                                background: "var(--bg-input, #0f172a)",
                                border: "1px solid var(--accent-cyan, #06b6d4)",
                                borderRadius: 3,
                                color: "#e2e8f0",
                                textAlign: "center",
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleSaveDistance(edge.id);
                                } else if (e.key === "Escape") {
                                  setEditingEdgeId(null);
                                }
                              }}
                              autoFocus
                              disabled={isUpdatingDistance}
                            />
                            <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>m</span>
                            <button
                              type="button"
                              className="btn btn-cyan"
                              style={{ padding: "1px 5px", fontSize: "0.68rem" }}
                              onClick={() => handleSaveDistance(edge.id)}
                              disabled={isUpdatingDistance}
                              title="Save distance"
                            >
                              <Check size={10} />
                            </button>
                            <button
                              type="button"
                              className="btn"
                              style={{ padding: "1px 4px", fontSize: "0.68rem" }}
                              onClick={() => setEditingEdgeId(null)}
                              disabled={isUpdatingDistance}
                              title="Cancel"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        ) : (
                          <span
                            style={{
                              color: onUpdateEdgeDistance ? "#38bdf8" : "var(--text-muted)",
                              fontSize: "0.7rem",
                              cursor: onUpdateEdgeDistance ? "pointer" : "default",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 3,
                              padding: "1px 4px",
                              borderRadius: 3,
                              background: onUpdateEdgeDistance ? "rgba(56, 189, 248, 0.08)" : "transparent",
                              border: onUpdateEdgeDistance ? "1px dashed rgba(56, 189, 248, 0.3)" : "none",
                            }}
                            title={onUpdateEdgeDistance ? "Click to edit distance / travel minutes" : undefined}
                            onClick={(e) => {
                              if (onUpdateEdgeDistance) {
                                e.stopPropagation();
                                setEditingEdgeId(edge.id);
                                setEditMinutes(String(edge.travel_minutes));
                              }
                            }}
                          >
                            {edge.travel_minutes}m
                            {onUpdateEdgeDistance && <Pencil size={9} style={{ opacity: 0.7 }} />}
                          </span>
                        )}

                        {onDeleteEdge && (() => {
                          const canRemove = canRemoveEdge(edge);
                          return (
                            <button
                              type="button"
                              className="item-remove-btn"
                              style={{
                                padding: 2,
                                opacity: canRemove ? 1 : 0.3,
                                cursor: canRemove ? "pointer" : "not-allowed",
                              }}
                              title={
                                canRemove
                                  ? "Remove this exit connection"
                                  : "Cannot remove: both locations must retain a valid path to the starting hub"
                              }
                              disabled={!canRemove || isRemovingEdgeId === edge.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteExit(edge);
                              }}
                            >
                              <Trash2 size={11} />
                            </button>
                          );
                        })()}
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: "0.7rem",
                        color: "var(--text-secondary)",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <span>Via: {edge.direction_label}</span>
                      {edge.is_locked_or_hidden && (
                        <span
                          style={{
                            color: "var(--accent-rose)",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3,
                          }}
                        >
                          <Lock size={10} /> Hidden/Locked
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
