import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ChevronUp, LogIn, X } from "lucide-react";
import {
  CompassDirection,
  LocationContainer,
  LocationEdge,
  LocationLoreNodeDraft,
  LocationNode,
  LocationOverrideOptions,
  WorldMediaItem,
} from "../types";
import { getViewportTier } from "../utils/campaignLayout";
import { LocationOverrideButton } from "./inspector/LocationOverrideButton";
import { resolveMapIconComponent } from "./map/mapIcons";
import {
  MapDetailsDrawer,
  WorldPromptContext,
} from "./map/MapDetailsDrawer";
import {
  EmptyCanvasCreateModal,
  EmptyCanvasLinkState,
  ExistingLinkTargetOption,
  GroupIntoContainerModal,
  GroupIntoContainerState,
  MapContextMenu,
  MapContextMenuState,
  MapIconBrowserModal,
  MultiEdgePopover,
  PassageHubCollisionModal,
  PassageHubCollisionState,
  StandaloneContainerCreateModal,
  StandaloneContainerCreateState,
} from "./map/MapDialogs";
import {
  computeEdgeClippedSegment,
  isEditableKeyboardTarget,
  type NodeShapeDescriptor,
} from "./map/mapGeometry";
import {
  MapPaletteBar,
  PALETTE_DRAG_MIME,
  PaletteItemKind,
} from "./map/MapPaletteBar";
import {
  computeUnreachableLocationIds,
  validateContainersState,
} from "./map/mapValidation";
import { PortalPromotionModal } from "./map/PortalPromotionModal";
import { type MapSearchMatch } from "./map/mapSearch";
import { SpatialTopologyCanvas } from "./map/SpatialTopologyCanvas";
import { TopologyHeaderToolbar } from "./map/TopologyHeaderToolbar";
import {
  resolveNodeConnectionEndpoint,
  useTopologyMutations,
} from "./map/useTopologyMutations";
import { useTopologyPointerDrag } from "./map/useTopologyPointerDrag";
import {
  COMPASS_ANGLES,
  COMPASS_ORDER,
  CONTAINER_DEPTH_LABELS,
  OPPOSITE_COMPASS,
  buildContainerBreadcrumb,
  buildContainerBreadcrumbChain,
  clientToWorldPoint,
  cloneGraph,
  computeDynamicPortalIds,
  computeFullMapCoords,
  computeGhostNodeCoords,
  computePromotionCandidates,
  getLocationOccupiedPorts,
  inferCompassDirection,
  pickCompassSlot,
  projectTopologyForDepth,
  resolveEdgePairForDialog,
  resolveInitialMapFocus,
  resolveLiveEdgeModalEdges,
  type GraphSnapshot,
  type InitialMapFocus,
  type LinkDragState,
  type NodeDragState,
  type ProjectedContainerSupernode,
  type ProjectedDepthTopology,
  type ProjectedExternalPortalDestination,
  type ProjectedGhostEdge,
  type ProjectedGhostExternalNode,
  type ProjectedTopologyEdge,
  type PromotionCandidate,
  type PromotionPromptState,
} from "./map/topologyProjection";

export {
  COMPASS_ANGLES,
  COMPASS_ORDER,
  CONTAINER_DEPTH_LABELS,
  OPPOSITE_COMPASS,
  buildContainerBreadcrumbChain,
  computeDynamicPortalIds,
  computeFullMapCoords,
  computeGhostNodeCoords,
  computePromotionCandidates,
  inferCompassDirection,
  pickCompassSlot,
  projectTopologyForDepth,
  resolveInitialMapFocus,
  type InitialMapFocus,
  type ProjectedContainerSupernode,
  type ProjectedDepthTopology,
  type ProjectedExternalPortalDestination,
  type ProjectedGhostEdge,
  type ProjectedGhostExternalNode,
  type ProjectedTopologyEdge,
  type PromotionCandidate,
  type PromotionPromptState,
};

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
  coLocatedPartyNpcs?: Array<{ id: string; name: string }>;
  onOverrideLocation?: (
    locationId: string,
    options?: LocationOverrideOptions
  ) => Promise<void> | void;
  isOverriding?: boolean;
  onSaveCampaignLocationLore?: (
    locationId: string,
    loreNodes: LocationLoreNodeDraft[]
  ) => Promise<void> | void;
  onSaveCampaignContainerLore?: (
    containerId: string,
    loreNodes: LocationLoreNodeDraft[]
  ) => Promise<void> | void;
  unlockLore?: boolean;
  revealedLoreIds?: readonly string[];
  onToggleLoreReveal?: (
    loreId: string,
    revealed: boolean
  ) => Promise<void> | void;
  isMutatingLocked?: boolean;
  initialContainerFocus?: "active" | "root";
  externalFocusRequest?: {
    kind: "location" | "container";
    id: string;
    nonce: number;
  } | null;
  worldMedia?: WorldMediaItem[];
  visitedContainerIds?: string[];
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
  coLocatedPartyNpcs = [],
  onOverrideLocation,
  isOverriding = false,
  onSaveCampaignLocationLore,
  onSaveCampaignContainerLore,
  unlockLore = false,
  revealedLoreIds = [],
  onToggleLoreReveal,
  isMutatingLocked = false,
  initialContainerFocus = "active",
  externalFocusRequest = null,
  worldMedia = [],
  visitedContainerIds = [],
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
    setInlineEdgeEdit(null);
    setContextMenu(null);
    if (isControlledExternally && onChangeGraph) {
      onChangeGraph(prev);
    } else {
      setDraft(prev);
      setInternalDirty(nextStack.length > 0);
    }
    setStatusNotice("Reverted last map action.");
  }, [undoStack, isMutatingLocked, isControlledExternally, onChangeGraph]);

  // Resolve initial container scope and viewport center once on mount
  const [initialFocus] = useState<InitialMapFocus>(() =>
    initialContainerFocus === "root"
      ? { currentContainerId: null, focalLocationId: null, pan: { x: 0, y: 0 } }
      : resolveInitialMapFocus(propContainers, propLocations, activeLocationId)
  );

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
  const [selectedGhostLocId, setSelectedGhostLocId] = useState<string | null>(
    null
  );
  const [ghostCoordsByView, setGhostCoordsByView] = useState<
    Record<string, Record<string, { x: number; y: number }>>
  >({});
  const [currentContainerId, setCurrentContainerId] = useState<string | null>(
    initialFocus.currentContainerId
  );
  const [hoveredNodeKey, setHoveredNodeKey] = useState<string | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== "undefined"
      ? getViewportTier(window.innerWidth) === "mobile"
      : false
  );
  const [isMobileSheetExpanded, setIsMobileSheetExpanded] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      const mobile = getViewportTier(window.innerWidth) === "mobile";
      setIsMobileViewport(mobile);
      if (!mobile) {
        setIsMobileSheetExpanded(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Viewport transform
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>(initialFocus.pan);
  const panDragRef = useRef<{
    active: boolean;
    moved: boolean;
    button: number;
    startClientX: number;
    startClientY: number;
    origPanX: number;
    origPanY: number;
  }>({
    active: false,
    moved: false,
    button: 0,
    startClientX: 0,
    startClientY: 0,
    origPanX: 0,
    origPanY: 0,
  });


  // Active drag state for nodes & containers
  const [nodeDrag, setNodeDrag] = useState<NodeDragState | null>(null);

  // Active compass link-port drag
  const [linkDrag, setLinkDrag] = useState<LinkDragState | null>(null);

  // Modals & Popovers
  const [contextMenu, setContextMenu] = useState<MapContextMenuState | null>(null);
  const [hubCollisionModal, setHubCollisionModal] =
    useState<PassageHubCollisionState | null>(null);
  const [emptyCanvasModal, setEmptyCanvasModal] =
    useState<EmptyCanvasLinkState | null>(null);
  const [groupModal, setGroupModal] =
    useState<GroupIntoContainerState | null>(null);
  const [standaloneContainerModal, setStandaloneContainerModal] =
    useState<StandaloneContainerCreateState | null>(null);
  const [promotionPrompt, setPromotionPrompt] =
    useState<PromotionPromptState | null>(null);
  const [multiEdgeModalEdges, setMultiEdgeModalEdges] = useState<
    LocationEdge[] | null
  >(null);
  const liveMultiEdgeModalEdges = useMemo(
    () => resolveLiveEdgeModalEdges(multiEdgeModalEdges, workingEdges),
    [multiEdgeModalEdges, workingEdges]
  );
  const [iconBrowserTarget, setIconBrowserTarget] = useState<{
    targetKind: "location" | "container";
    targetId: string;
    kind: "location" | "hub" | "container";
    depth?: 1 | 2 | 3 | 4;
    currentIconKey?: string | null;
    name?: string;
    tags?: string[];
  } | null>(null);
  const usedMapIconKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const loc of workingLocations) {
      if (loc.icon) keys.add(loc.icon);
    }
    for (const cont of workingContainers) {
      if (cont.icon) keys.add(cont.icon);
    }
    return Array.from(keys);
  }, [workingLocations, workingContainers]);

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

  useEffect(() => {
    if (
      inlineEdgeEdit &&
      !workingEdges.some((e) => e.id === inlineEdgeEdit.edgeId)
    ) {
      setInlineEdgeEdit(null);
    }
  }, [workingEdges, inlineEdgeEdit]);

  const activeLoc = useMemo(
    () =>
      workingLocations.find((l) => l.id === activeLocationId) ??
      workingLocations.find((l) => l.is_starting_location) ??
      workingLocations[0],
    [workingLocations, activeLocationId]
  );

  const selectedLocation = useMemo(
    () =>
      !selectedContainerId && !selectedGhostLocId && selectedLocId
        ? workingLocations.find((l) => l.id === selectedLocId) ?? null
        : null,
    [workingLocations, selectedLocId, selectedContainerId, selectedGhostLocId]
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

  useEffect(() => {
    if (
      selectedGhostLocId &&
      !projectedTopology.ghostExternalNodes.some(
        (g) => g.destination.id === selectedGhostLocId
      )
    ) {
      setSelectedGhostLocId(null);
    }
  }, [projectedTopology.ghostExternalNodes, selectedGhostLocId]);

  const selectedGhost = useMemo(
    () =>
      selectedGhostLocId
        ? projectedTopology.ghostExternalNodes.find(
            (g) => g.destination.id === selectedGhostLocId
          ) ?? null
        : null,
    [selectedGhostLocId, projectedTopology.ghostExternalNodes]
  );

  const selectedGhostEdges = useMemo(
    () =>
      selectedGhostLocId
        ? projectedTopology.ghostEdges.filter(
            (ge) => ge.externalLocationId === selectedGhostLocId
          )
        : [],
    [selectedGhostLocId, projectedTopology.ghostEdges]
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
    if (nodeDrag && nodeDrag.hasMoved && nodeDrag.kind !== "ghost") {
      computed[nodeDrag.id] = { x: nodeDrag.currX, y: nodeDrag.currY };
    }
    return computed;
  }, [projectedTopology, nodeDrag]);

  const ghostViewKey = currentContainerId ?? "__root__";
  const currentGhostOverrides = ghostCoordsByView[ghostViewKey];
  const ghostCoords = useMemo(() => {
    const computed = computeGhostNodeCoords(
      projectedTopology.ghostExternalNodes,
      projectedTopology.ghostEdges,
      fullMapCoords,
      currentGhostOverrides
    );
    if (nodeDrag && nodeDrag.hasMoved && nodeDrag.kind === "ghost") {
      computed[nodeDrag.id] = { x: nodeDrag.currX, y: nodeDrag.currY };
    }
    return computed;
  }, [
    projectedTopology.ghostExternalNodes,
    projectedTopology.ghostEdges,
    fullMapCoords,
    currentGhostOverrides,
    nodeDrag,
  ]);

  const handleMoveGhostNode = useCallback(
    (externalLocId: string, x: number, y: number) => {
      setGhostCoordsByView((prev) => ({
        ...prev,
        [ghostViewKey]: {
          ...(prev[ghostViewKey] ?? {}),
          [externalLocId]: { x, y },
        },
      }));
    },
    [ghostViewKey]
  );

  const handleResetGhostCoords = useCallback(
    (externalLocId: string) => {
      setGhostCoordsByView((prev) => {
        const viewMap = prev[ghostViewKey];
        if (!viewMap || !viewMap[externalLocId]) return prev;
        const { [externalLocId]: _removed, ...rest } = viewMap;
        return { ...prev, [ghostViewKey]: rest };
      });
    },
    [ghostViewKey]
  );

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

  const [pendingCenterTarget, setPendingCenterTarget] = useState<{
    id: string;
    nonce: number;
  } | null>(null);
  const centerNonceRef = useRef(0);

  useEffect(() => {
    if (!pendingCenterTarget) return;
    const pt = fullMapCoords[pendingCenterTarget.id];
    if (!pt) return;
    setPan({
      x: pt.x === 0 ? 0 : -pt.x,
      y: pt.y === 0 ? 0 : -pt.y,
    });
    setPendingCenterTarget(null);
  }, [pendingCenterTarget, fullMapCoords]);

  const drillIntoContainer = useCallback((contId: string | null) => {
    setPendingCenterTarget(null);
    setCurrentContainerId(contId);
    setSelectedContainerId(null);
    setSelectedGhostLocId(null);
    setContextMenu(null);
    setInlineEdgeEdit(null);
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }, []);

  const handleJumpToContainer = useCallback(
    (targetContainerId: string | null, focusLocId?: string) => {
      setCurrentContainerId(targetContainerId);
      setSelectedContainerId(null);
      setSelectedGhostLocId(null);
      setSelectedLocId(focusLocId ?? null);
      setContextMenu(null);
      setInlineEdgeEdit(null);
      setZoom(1);
      if (!focusLocId) {
        setPendingCenterTarget(null);
        setPan({ x: 0, y: 0 });
        return;
      }
      if (targetContainerId === currentContainerId && fullMapCoords[focusLocId]) {
        const pt = fullMapCoords[focusLocId];
        setPendingCenterTarget(null);
        setPan({
          x: pt.x === 0 ? 0 : -pt.x,
          y: pt.y === 0 ? 0 : -pt.y,
        });
        return;
      }
      const targetLoc = locationMap.get(focusLocId);
      if (
        targetLoc &&
        typeof targetLoc.ui_x === "number" &&
        Number.isFinite(targetLoc.ui_x) &&
        typeof targetLoc.ui_y === "number" &&
        Number.isFinite(targetLoc.ui_y)
      ) {
        setPendingCenterTarget(null);
        setPan({
          x: targetLoc.ui_x === 0 ? 0 : -targetLoc.ui_x,
          y: targetLoc.ui_y === 0 ? 0 : -targetLoc.ui_y,
        });
      } else {
        setPan({ x: 0, y: 0 });
        setPendingCenterTarget({
          id: focusLocId,
          nonce: ++centerNonceRef.current,
        });
      }
    },
    [currentContainerId, fullMapCoords, locationMap]
  );

  const handleFocusSearchResult = useCallback(
    (match: MapSearchMatch) => {
      if (match.kind === "container") {
        if (!containerMap.has(match.id)) return;
        setSelectedLocId(null);
        drillIntoContainer(match.id);
        return;
      }
      const targetLoc = locationMap.get(match.id);
      if (!targetLoc) return;
      const targetScopeId =
        targetLoc.container_id && containerMap.has(targetLoc.container_id)
          ? targetLoc.container_id
          : null;
      handleJumpToContainer(targetScopeId, targetLoc.id);
    },
    [containerMap, locationMap, drillIntoContainer, handleJumpToContainer]
  );

  const handleCenter = useCallback(() => {
    if (zoom < 0.6 || zoom > 2.2) {
      setZoom(1);
    }

    if (selectedGhostLocId && ghostCoords[selectedGhostLocId]) {
      const pt = ghostCoords[selectedGhostLocId];
      setPan({ x: -pt.x, y: -pt.y });
      return;
    }

    const directTargetId =
      selectedContainer?.id || selectedLocation?.id || activeLoc?.id;
    if (directTargetId && fullMapCoords[directTargetId]) {
      const pt = fullMapCoords[directTargetId];
      setPan({ x: -pt.x, y: -pt.y });
      return;
    }

    // Walk activeLoc's ancestor containers to see if a supernode is visible in the current view
    if (activeLoc) {
      let ancId = activeLoc.container_id ?? null;
      const seen = new Set<string>();
      while (ancId && !seen.has(ancId)) {
        seen.add(ancId);
        if (fullMapCoords[ancId]) {
          const pt = fullMapCoords[ancId];
          setPan({ x: -pt.x, y: -pt.y });
          return;
        }
        ancId = containerMap.get(ancId)?.parent_container_id ?? null;
      }
      // Active location is in another container branch -> jump to it
      handleJumpToContainer(activeLoc.container_id ?? null, activeLoc.id);
      return;
    }

    setPan({ x: 0, y: 0 });
  }, [
    zoom,
    selectedGhostLocId,
    ghostCoords,
    selectedContainer,
    selectedLocation,
    activeLoc,
    fullMapCoords,
    containerMap,
    handleJumpToContainer,
  ]);

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

  const lastExternalFocusNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!externalFocusRequest) return;
    if (lastExternalFocusNonceRef.current === externalFocusRequest.nonce) return;
    lastExternalFocusNonceRef.current = externalFocusRequest.nonce;

    if (externalFocusRequest.kind === "location") {
      const targetLoc = locationMap.get(externalFocusRequest.id);
      if (!targetLoc) return;
      handleJumpToContainer(targetLoc.container_id ?? null, targetLoc.id);
      return;
    }

    const targetCont = containerMap.get(externalFocusRequest.id);
    if (!targetCont) return;
    setCurrentContainerId(targetCont.parent_container_id ?? null);
    setSelectedLocId(null);
    setSelectedGhostLocId(null);
    setSelectedContainerId(targetCont.id);
    setContextMenu(null);
    setInlineEdgeEdit(null);
    setZoom(1);
    if (
      typeof targetCont.ui_x === "number" &&
      Number.isFinite(targetCont.ui_x) &&
      typeof targetCont.ui_y === "number" &&
      Number.isFinite(targetCont.ui_y)
    ) {
      setPan({
        x: targetCont.ui_x === 0 ? 0 : -targetCont.ui_x,
        y: targetCont.ui_y === 0 ? 0 : -targetCont.ui_y,
      });
    } else {
      setPan({ x: 0, y: 0 });
      setPendingCenterTarget({
        id: targetCont.id,
        nonce: ++centerNonceRef.current,
      });
    }
  }, [externalFocusRequest, locationMap, containerMap, handleJumpToContainer]);

  const {
    patchLocation,
    patchContainer,
    resetCoordinates,
    availableContainerDepthsHere,
    canAddContainerHere,
    createStandaloneAt,
    handleConfirmStandaloneContainerCreate,
    initiateConnection,
    handleConfirmPortalPrompt,
    handleConfirmHubCollision,
    handleConfirmEmptyCanvasCreate,
    handleLinkExistingFromEmptyCanvas,
    handleConfirmGroupIntoContainer,
    executeImmediateContainerMove,
    canDeleteLocation,
    canDeleteContainer,
    canConvertLocation,
    canMoveOutToParent,
    handleDeleteLocation,
    handleDeleteContainer,
    handleConvertLocationToContainer,
    handleSetStartingLocation,
    handleUpdateEdgeDistance,
    handleUpdateEdgeLabel,
    handleCommitEdgeEdits,
    handleToggleEdgeLocked,
    handleDeleteEdge,
    handleDeleteEdgeGroup,
  } = useTopologyMutations({
    worldId,
    mode,
    propContainers,
    propLocations,
    workingContainers,
    workingLocations,
    workingEdges,
    baselineContainerIds,
    currentContainerId,
    containerMap,
    locationMap,
    occupiedSlotsByLocId,
    projectedTopology,
    fullMapCoords,
    selectedLocId,
    selectedContainerId,
    isMutatingLocked,
    commitNextGraph,
    setSelectedContainerId,
    setSelectedLocId,
    setStatusNotice,
    hubCollisionModal,
    setHubCollisionModal,
    emptyCanvasModal,
    setEmptyCanvasModal,
    groupModal,
    setGroupModal,
    standaloneContainerModal,
    setStandaloneContainerModal,
    setMultiEdgeModalEdges,
    setPromotionPrompt,
  });

  const emptyCanvasExistingTargets = useMemo<ExistingLinkTargetOption[]>(() => {
    if (!emptyCanvasModal) return [];
    const sourceLoc = resolveNodeConnectionEndpoint({
      kind: emptyCanvasModal.sourceKind,
      id: emptyCanvasModal.sourceId,
      locationMap,
      containerMap,
      workingContainers,
      workingLocations,
      dynamicPortalIds: projectedTopology.dynamicPortalIds,
    }).loc;
    if (!sourceLoc) return [];
    return workingLocations
      .filter((loc) => loc.id !== sourceLoc.id)
      .map((loc) => {
        const alreadyLinked = workingEdges.some(
          (e) =>
            (e.from_location_id === sourceLoc.id && e.to_location_id === loc.id) ||
            (e.from_location_id === loc.id && e.to_location_id === sourceLoc.id)
        );
        return {
          location: loc,
          breadcrumb: buildContainerBreadcrumb(loc.container_id, workingContainers),
          alreadyLinked,
          occupiedPorts: getLocationOccupiedPorts(loc.id, workingEdges, locationMap),
          isPortal: projectedTopology.dynamicPortalIds.has(loc.id),
        };
      });
  }, [
    emptyCanvasModal,
    locationMap,
    containerMap,
    workingContainers,
    workingLocations,
    workingEdges,
    projectedTopology.dynamicPortalIds,
  ]);

  useTopologyPointerDrag({
    nodeDrag,
    setNodeDrag,
    linkDrag,
    setLinkDrag,
    pan,
    zoom,
    svgRef,
    viewportGroupRef,
    projectedTopology,
    fullMapCoords,
    currentContainerId,
    workingContainers,
    workingLocations,
    mode,
    propContainers,
    propLocations,
    locationMap,
    containerMap,
    setSelectedContainerId,
    setSelectedLocId,
    setSelectedGhostLocId,
    onMoveGhostNode: handleMoveGhostNode,
    setStatusNotice,
    setGroupModal,
    setEmptyCanvasModal,
    executeImmediateContainerMove,
    patchLocation,
    patchContainer,
    initiateConnection,
    canAddContainerHere,
    availableContainerDepthsHere,
  });

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

  // Global Delete-key removal for selected location, hub, or container (Undo-backed)
  const hasBlockingOverlayOpen = Boolean(
    inlineEdgeEdit ||
      contextMenu ||
      hubCollisionModal ||
      emptyCanvasModal ||
      groupModal ||
      standaloneContainerModal ||
      promotionPrompt ||
      multiEdgeModalEdges ||
      iconBrowserTarget
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key !== "Delete" ||
        e.repeat ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.shiftKey
      ) {
        return;
      }
      if (isMutatingLocked || effectiveSaving || hasBlockingOverlayOpen) {
        return;
      }
      if (
        isEditableKeyboardTarget(e.target) ||
        isEditableKeyboardTarget(
          typeof document !== "undefined" ? document.activeElement : null
        )
      ) {
        return;
      }

      if (selectedGhostLocId) {
        e.preventDefault();
        setStatusNotice(
          "External ghost nodes are read-only here — delete the dashed boundary link line instead, or jump to its home container."
        );
        return;
      }

      if (selectedContainerId) {
        e.preventDefault();
        const check = canDeleteContainer(selectedContainerId);
        if (!check.allowed) {
          if (check.reason) setStatusNotice(check.reason);
          return;
        }
        handleDeleteContainer(selectedContainerId);
        return;
      }

      if (selectedLocId) {
        e.preventDefault();
        const check = canDeleteLocation(selectedLocId);
        if (!check.allowed) {
          if (check.reason) setStatusNotice(check.reason);
          return;
        }
        handleDeleteLocation(selectedLocId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isMutatingLocked,
    effectiveSaving,
    hasBlockingOverlayOpen,
    selectedGhostLocId,
    selectedContainerId,
    selectedLocId,
    canDeleteContainer,
    canDeleteLocation,
    handleDeleteContainer,
    handleDeleteLocation,
  ]);

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

  const openEdgeDetailsPopover = useCallback(
    (edgeId: string, groupedEdgeIds?: string[]) => {
      const pair = resolveEdgePairForDialog(edgeId, workingEdges, groupedEdgeIds);
      if (pair.length > 0) {
        setInlineEdgeEdit(null);
        setMultiEdgeModalEdges(pair);
      }
    },
    [workingEdges]
  );

  const selectedExternalPortals = useMemo(() => {
    if (!selectedLocation) return [];
    return (projectedTopology.externalPortalsByLocationId[selectedLocation.id] ?? []).map(
      (ext) => ({
        edgeId: ext.edge.id,
        destinationName: ext.destination.name,
        destinationContainerName: ext.destinationContainerName ?? "World Root",
        directionLabel: ext.edge.direction_label,
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

  const hasDetailsOpen = Boolean(
    selectedLocation || selectedContainer || selectedGhost
  );

  useEffect(() => {
    if (!hasDetailsOpen) {
      setIsMobileSheetExpanded(false);
    }
  }, [hasDetailsOpen]);

  const handleMoveOutToParent = useCallback(
    (kind: "location" | "container", id: string) => {
      const parentId =
        kind === "location"
          ? locationMap.get(id)?.container_id
          : containerMap.get(id)?.parent_container_id;
      const grandParentId = parentId
        ? containerMap.get(parentId)?.parent_container_id ?? null
        : null;
      executeImmediateContainerMove(kind, id, grandParentId);
    },
    [locationMap, containerMap, executeImmediateContainerMove]
  );

  const handleQuickAddElement = useCallback(
    (kind: PaletteItemKind) => createStandaloneAt(kind, -pan.x + 55, -pan.y + 35),
    [createStandaloneAt, pan.x, pan.y]
  );

  const paletteValidationMessage =
    reachabilityReport.starterError || containerValidationErrors[0] || null;

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
      <TopologyHeaderToolbar
        title={title}
        locationsCount={workingLocations.length}
        edgesCount={workingEdges.length}
        containersCount={workingContainers.length}
        onReimagineMap={onReimagineMap}
        hasSaveMap={Boolean(onSaveMap)}
        effectiveDirty={effectiveDirty}
        hasBlockingErrors={hasBlockingErrors}
        effectiveSaving={effectiveSaving}
        isMutatingLocked={isMutatingLocked}
        validationSummary={validationSummary}
        handleSaveClick={handleSaveClick}
        onClose={onClose}
        handleCloseClick={handleCloseClick}
        currentContainerId={currentContainerId}
        projectedTopology={projectedTopology}
        drillIntoContainer={drillIntoContainer}
        searchLocations={workingLocations}
        searchContainers={workingContainers}
        activeLocationId={activeLoc?.id}
        onFocusSearchResult={handleFocusSearchResult}
        isMobileViewport={isMobileViewport}
      />

      {/* Draggable Node Palette Bar + Undo + Validation Status */}
      <MapPaletteBar
        canAddContainerHere={canAddContainerHere}
        isMutatingLocked={isMutatingLocked}
        undoCount={undoStack.length}
        onUndo={handleUndo}
        onQuickAdd={handleQuickAddElement}
        unreachableCount={reachabilityReport.unreachableIds.length}
        validationMessage={paletteValidationMessage}
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

      {/* Main Split Body: Canvas + Contextual Right Details Drawer (or Mobile Peek Bar + Bottom Sheet) */}
      <div className="map-topology-split">
        {/* Left Interactive SVG Canvas Container */}
        <div
          ref={canvasWrapRef}
          className="map-canvas-wrap"
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
          <SpatialTopologyCanvas
            svgRef={svgRef}
            canvasWrapRef={canvasWrapRef}
            viewportGroupRef={viewportGroupRef}
            panDragRef={panDragRef}
            mode={mode}
            zoom={zoom}
            setZoom={setZoom}
            pan={pan}
            setPan={setPan}
            nodeDrag={nodeDrag}
            setNodeDrag={setNodeDrag}
            linkDrag={linkDrag}
            setLinkDrag={setLinkDrag}
            hoveredNodeKey={hoveredNodeKey}
            setHoveredNodeKey={setHoveredNodeKey}
            projectedTopology={projectedTopology}
            fullMapCoords={fullMapCoords}
            ghostCoords={ghostCoords}
            selectedContainer={selectedContainer}
            selectedLocation={selectedLocation}
            selectedGhostLocId={selectedGhostLocId}
            activeLoc={activeLoc}
            activeNeighborIds={activeNeighborIds}
            unreachableSet={unreachableSet}
            occupiedSlotsByLocId={occupiedSlotsByLocId}
            isMutatingLocked={isMutatingLocked}
            inlineEdgeEdit={inlineEdgeEdit}
            setInlineEdgeEdit={setInlineEdgeEdit}
            statusNotice={statusNotice}
            setStatusNotice={setStatusNotice}
            setSelectedLocId={setSelectedLocId}
            setSelectedContainerId={setSelectedContainerId}
            setSelectedGhostLocId={setSelectedGhostLocId}
            setContextMenu={setContextMenu}
            setMultiEdgeModalEdges={setMultiEdgeModalEdges}
            openContextMenuAt={openContextMenuAt}
            handleUpdateEdgeDistance={handleUpdateEdgeDistance}
            handleDeleteEdge={handleDeleteEdge}
            handleDeleteEdgeGroup={handleDeleteEdgeGroup}
            drillIntoContainer={drillIntoContainer}
            onJumpToContainer={handleJumpToContainer}
            handleCenter={handleCenter}
            isMobileViewport={isMobileViewport}
            undoCount={undoStack.length}
            onUndo={handleUndo}
            validationMessage={paletteValidationMessage}
            unreachableCount={reachabilityReport.unreachableIds.length}
            onFocusInvalid={handleFocusInvalid}
            canAddContainerHere={canAddContainerHere}
            onQuickAdd={handleQuickAddElement}
          />

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
              const projected = projectedTopology.projectedEdges.find(
                (pe) =>
                  pe.rawEdge.id === edgeId ||
                  pe.groupedEdges?.some((ge) => ge.id === edgeId)
              );
              const ghostProj = projected
                ? undefined
                : projectedTopology.ghostEdges.find(
                    (ge) => ge.rawEdge.id === edgeId
                  );
              const srcId =
                projected?.sourceNodeId ??
                ghostProj?.sourceNodeId ??
                edge.from_location_id;
              const tgtId =
                projected?.targetNodeId ??
                ghostProj?.targetNodeId ??
                edge.to_location_id;
              const p1 =
                (ghostProj && srcId === ghostProj.externalLocationId
                  ? ghostCoords[srcId]
                  : fullMapCoords[srcId]) ?? { x: 0, y: 0 };
              const p2 =
                (ghostProj && tgtId === ghostProj.externalLocationId
                  ? ghostCoords[tgtId]
                  : fullMapCoords[tgtId]) ?? { x: 0, y: 0 };
              const shapeFor = (id: string): NodeShapeDescriptor => {
                if (ghostProj && id === ghostProj.externalLocationId) {
                  return { kind: "ghost" };
                }
                if (containerMap.has(id)) return { kind: "container" };
                return locationMap.get(id)?.is_hub
                  ? { kind: "hub" }
                  : { kind: "location" };
              };
              const clipped = computeEdgeClippedSegment(
                p1,
                shapeFor(srcId),
                p2,
                shapeFor(tgtId)
              );
              setInlineEdgeEdit({
                edgeId,
                midX: clipped.midX,
                midY: clipped.midY,
                value: String(edge.travel_minutes),
              });
            }}
            onEditEdgeDetails={openEdgeDetailsPopover}
            onToggleEdgeLocked={handleToggleEdgeLocked}
            onDeleteEdge={handleDeleteEdge}
            onDeleteEdgeGroup={handleDeleteEdgeGroup}
          />

          <PassageHubCollisionModal
            state={hubCollisionModal}
            onCancel={() => setHubCollisionModal(null)}
            onConfirm={handleConfirmHubCollision}
          />

          <EmptyCanvasCreateModal
            state={emptyCanvasModal}
            existingTargets={emptyCanvasExistingTargets}
            onCancel={() => setEmptyCanvasModal(null)}
            onCreate={handleConfirmEmptyCanvasCreate}
            onLinkExisting={handleLinkExistingFromEmptyCanvas}
          />

          <GroupIntoContainerModal
            state={groupModal}
            onCancel={() => setGroupModal(null)}
            onConfirm={handleConfirmGroupIntoContainer}
          />

          <StandaloneContainerCreateModal
            state={standaloneContainerModal}
            onCancel={() => setStandaloneContainerModal(null)}
            onCreate={handleConfirmStandaloneContainerCreate}
          />

          <MultiEdgePopover
            edges={liveMultiEdgeModalEdges}
            locationMap={locationMap}
            isMutatingLocked={isMutatingLocked}
            onClose={() => setMultiEdgeModalEdges(null)}
            onUpdateDistance={handleUpdateEdgeDistance}
            onUpdateLabel={handleUpdateEdgeLabel}
            onCommitEdgeEdits={handleCommitEdgeEdits}
            onToggleLocked={handleToggleEdgeLocked}
            onDeleteEdge={handleDeleteEdge}
          />

          <PortalPromotionModal
            promotionPrompt={promotionPrompt}
            containerMap={containerMap}
            dynamicPortalIds={projectedTopology.dynamicPortalIds}
            edges={workingEdges}
            locationMap={locationMap}
            onChangePrompt={setPromotionPrompt}
            onConfirm={handleConfirmPortalPrompt}
          />

          <MapIconBrowserModal
            isOpen={Boolean(iconBrowserTarget)}
            title={iconBrowserTarget?.name || "Element"}
            currentIconKey={iconBrowserTarget?.currentIconKey}
            kind={iconBrowserTarget?.kind ?? "location"}
            depth={iconBrowserTarget?.depth}
            genre={worldContext?.genre}
            elementName={iconBrowserTarget?.name}
            elementTags={iconBrowserTarget?.tags}
            usedIconKeys={usedMapIconKeys}
            onSelect={(iconKey) => {
              if (!iconBrowserTarget) return;
              if (iconBrowserTarget.targetKind === "container") {
                patchContainer(iconBrowserTarget.targetId, { icon: iconKey });
              } else {
                patchLocation(iconBrowserTarget.targetId, { icon: iconKey });
              }
            }}
            onClose={() => setIconBrowserTarget(null)}
          />

        </div>

        {/* Right Details Drawer (Desktop) OR Docked Peek Bar + Expandable Bottom Sheet (Mobile) */}
        {(() => {
          const detailsDrawerEl = hasDetailsOpen ? (
            <MapDetailsDrawer
              mode={mode}
              selectedLocation={selectedLocation}
              selectedContainer={selectedContainer}
              selectedGhost={selectedGhost}
              selectedGhostEdges={selectedGhostEdges}
              hasGhostOverride={Boolean(
                selectedGhostLocId && currentGhostOverrides?.[selectedGhostLocId]
              )}
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
                if (isMobileViewport) {
                  setIsMobileSheetExpanded(false);
                } else {
                  setSelectedLocId(null);
                  setSelectedContainerId(null);
                  setSelectedGhostLocId(null);
                }
              }}
              onPatchLocation={patchLocation}
              onPatchContainer={patchContainer}
              onResetCoordinates={resetCoordinates}
              onResetGhostCoords={handleResetGhostCoords}
              onDeleteEdge={handleDeleteEdge}
              onInspectEdgePair={openEdgeDetailsPopover}
              onJumpToContainer={handleJumpToContainer}
              onDrillIntoContainer={(cid) => {
                setIsMobileSheetExpanded(false);
                drillIntoContainer(cid);
              }}
              coLocatedPartyNpcs={coLocatedPartyNpcs}
              onOverrideLocation={onOverrideLocation}
              isOverriding={isOverriding}
              onSaveCampaignLocationLore={onSaveCampaignLocationLore}
              onSaveCampaignContainerLore={onSaveCampaignContainerLore}
              unlockLore={unlockLore}
              revealedLoreIds={revealedLoreIds}
              onToggleLoreReveal={onToggleLoreReveal}
              usedIconKeys={usedMapIconKeys}
              onOpenIconBrowser={setIconBrowserTarget}
              worldMedia={worldMedia}
              visitedContainerIds={visitedContainerIds}
              canDeleteLocation={canDeleteLocation}
              canDeleteContainer={canDeleteContainer}
              canConvertLocation={canConvertLocation}
              canMoveOutToParent={canMoveOutToParent}
              onDeleteLocation={handleDeleteLocation}
              onDeleteContainer={handleDeleteContainer}
              onSetStartingLocation={handleSetStartingLocation}
              onConvertToContainer={handleConvertLocationToContainer}
              onMoveOutToParent={handleMoveOutToParent}
            />
          ) : null;

          if (isMobileViewport) {
            if (!hasDetailsOpen) return null;

            const peekName = selectedContainer
              ? selectedContainer.name
              : selectedGhost
              ? selectedGhost.destination.name
              : selectedLocation?.name ?? "";
            const peekBadge = selectedContainer
              ? `L${selectedContainer.depth}`
              : selectedGhost
              ? "Portal"
              : selectedLocation?.id === activeLoc?.id
              ? mode === "campaign"
                ? "Current"
                : "Start"
              : selectedLocation?.is_hub
              ? "Hub"
              : "Location";
            const PeekIcon = selectedContainer
              ? resolveMapIconComponent(
                  selectedContainer.icon,
                  "container",
                  selectedContainer.depth
                )
              : selectedGhost
              ? resolveMapIconComponent(
                  selectedGhost.destination.icon,
                  selectedGhost.destination.is_hub ? "hub" : "location"
                )
              : resolveMapIconComponent(
                  selectedLocation?.icon,
                  selectedLocation?.is_hub ? "hub" : "location"
                );

            return (
              <>
                {!isMobileSheetExpanded && (
                  <div
                    className="map-mobile-peek-bar"
                    role="region"
                    aria-label="Selected map element"
                  >
                    <button
                      type="button"
                      className="map-mobile-peek-main"
                      onClick={() => setIsMobileSheetExpanded(true)}
                      aria-label={`Inspect ${peekName}`}
                    >
                      <PeekIcon
                        size={15}
                        color={
                          selectedContainer ||
                          selectedLocation?.id === activeLoc?.id
                            ? "#fbbf24"
                            : "#22d3ee"
                        }
                        style={{ flexShrink: 0 }}
                      />
                      <span className="map-mobile-peek-name">{peekName}</span>
                      <span className="badge map-mobile-peek-badge">
                        {peekBadge}
                      </span>
                    </button>

                    <div className="map-mobile-peek-actions">
                      {selectedContainer && (
                        <button
                          type="button"
                          className="btn btn-cyan map-mobile-peek-cta"
                          onClick={() => drillIntoContainer(selectedContainer.id)}
                        >
                          <LogIn size={13} />
                          <span>Enter</span>
                        </button>
                      )}
                      {selectedGhost && (
                        <button
                          type="button"
                          className="btn btn-cyan map-mobile-peek-cta"
                          onClick={() =>
                            handleJumpToContainer(
                              selectedGhost.destination.container_id ?? null,
                              selectedGhost.destination.id
                            )
                          }
                        >
                          <LogIn size={13} />
                          <span>Jump</span>
                        </button>
                      )}
                      {selectedLocation &&
                        !selectedContainer &&
                        !selectedGhost &&
                        mode === "campaign" &&
                        selectedLocation.id !== activeLoc?.id &&
                        onOverrideLocation && (
                          <div className="map-mobile-peek-override">
                            <LocationOverrideButton
                              targetLocationId={selectedLocation.id}
                              targetLocationName={selectedLocation.name}
                              coLocatedPartyNpcs={coLocatedPartyNpcs}
                              disabled={isOverriding}
                              isPending={isOverriding}
                              compact
                              onOverride={onOverrideLocation}
                            />
                          </div>
                        )}
                      <button
                        type="button"
                        className="btn map-mobile-peek-btn"
                        onClick={() => setIsMobileSheetExpanded(true)}
                        aria-label="Open details"
                        title="Open details"
                      >
                        <ChevronUp size={15} />
                        <span>Details</span>
                      </button>
                      <button
                        type="button"
                        className="btn map-mobile-peek-dismiss"
                        onClick={() => {
                          setSelectedLocId(null);
                          setSelectedContainerId(null);
                          setSelectedGhostLocId(null);
                        }}
                        aria-label="Clear selection"
                        title="Clear selection"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                )}

                {isMobileSheetExpanded && (
                  <>
                    <div
                      className="map-mobile-sheet-backdrop"
                      onClick={() => setIsMobileSheetExpanded(false)}
                    />
                    <div
                      className="map-mobile-details-sheet"
                      role="dialog"
                      aria-label="Map Element Details Sheet"
                    >
                      {detailsDrawerEl}
                    </div>
                  </>
                )}
              </>
            );
          }

          return hasDetailsOpen ? (
            detailsDrawerEl
          ) : (
            <div
              aria-label="Map Element Details Placeholder"
              className="map-details-placeholder"
            >
              <strong style={{ color: "var(--text-secondary)", fontSize: "0.8rem" }}>
                No Map Element Selected
              </strong>
              <span>
                Click any location, container, or external ghost destination to inspect its details.
              </span>
              <span style={{ fontSize: "0.7rem" }}>
                Double-click a container card to enter it, or double-click a distance badge to edit travel time.
              </span>
            </div>
          );
        })()}
      </div>
    </div>
  );
};
