import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ChevronUp, LogIn, X } from "lucide-react";
import {
  CompassDirection,
  LocationContainer,
  LocationEdge,
  LocationLoreNodeDraft,
  LocationNode,
  LocationOverrideOptions,
  LocationProp,
  LoreNode,
  MechanicsTopicId,
  WorldMediaItem,
} from "../types";
import { getViewportTier } from "../utils/campaignLayout";
import { LocationOverrideButton } from "./inspector/LocationOverrideButton";
import { resolveMapIconComponent } from "./map/mapIcons";
import {
  MapDetailsDrawer,
  WorldPromptContext,
} from "./map/MapDetailsDrawer";
import type { PropTransferTarget } from "./map/MapPropsSection";
import {
  EmptyCanvasCreateModal,
  EmptyCanvasLinkState,
  ExistingLinkTargetOption,
  GroupIntoContainerModal,
  GroupIntoContainerState,
  MapContextMenu,
  MapContextMenuState,
  MapIconBrowserModal,
  PassageHubCollisionModal,
  PassageHubCollisionState,
  StandaloneContainerCreateModal,
  StandaloneContainerCreateState,
} from "./map/MapDialogs";
import {
  CONTAINER_CARD_HALF_H,
  CONTAINER_CARD_HALF_W,
  computeEdgeClippedSegment,
  computeResponsiveViewBox,
  isEditableKeyboardTarget,
  type NodeShapeDescriptor,
} from "./map/mapGeometry";
import {
  computeScopedAutoLayout,
  computeViewportFitForCoords,
} from "./map/mapAutoLayout";
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
import { MapConsistencyPanel } from "./map/MapConsistencyPanel";
import {
  analyzeSpatialConsistency,
  analyzeWorldConsistencySummary,
  suggestExistingLinkGeometry,
  type EdgeConsistencyDiagnostic,
  type ReconciliationAdjustment,
} from "./map/spatialConsistency";
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
  areGraphSnapshotsEqual,
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
  isEdgeRevealed,
  pickCompassSlot,
  projectTopologyForDepth,
  resolveBundleLinkPairs,
  resolveInitialMapFocus,
  resolveLinkPairForInspector,
  resolveRevealedEdgePairs,
  type GraphSnapshot,
  type InitialMapFocus,
  type LinkDragState,
  type LinkPairInspectorData,
  type NodeDragState,
  type PortReassignDragState,
  type ProjectedContainerSupernode,
  type ProjectedDepthTopology,
  type ProjectedExternalPortalDestination,
  type ProjectedGhostEdge,
  type ProjectedGhostExternalNode,
  type ProjectedTopologyEdge,
  type PromotionCandidate,
  type PromotionPromptState,
  type SelectedEdgeState,
} from "./map/topologyProjection";

export type { SelectedEdgeState };

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
  computeScopedAutoLayout,
  computeViewportFitForCoords,
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
  onSaveMap?: (graph: GraphSnapshot) => Promise<boolean | void> | boolean | void;
  onSaveAndCloseMap?: (
    graph: GraphSnapshot
  ) => Promise<boolean | void> | boolean | void;
  onChangeGraph?: (next: GraphSnapshot) => void;
  onClose?: () => void;
  onRequestClose?: () => void;
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
  revealedEdgeIds?: readonly string[];
  onToggleEdgeReveal?: (
    edgeId: string,
    revealed: boolean
  ) => Promise<void> | void;
  revealedPropIds?: readonly string[];
  worldArtifactLore?: LoreNode[];
  propTransferTargets?: PropTransferTarget[];
  onSaveCampaignLocationProps?: (
    locationId: string,
    props: LocationProp[]
  ) => Promise<void> | void;
  onTogglePropReveal?: (
    propId: string,
    revealed: boolean
  ) => Promise<void> | void;
  onTransferProp?: (
    propId: string,
    holderId: string
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
  onOpenMechanicsHelp?: (topicId: MechanicsTopicId) => void;
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
  onSaveAndCloseMap,
  onChangeGraph,
  onClose,
  onRequestClose,
  onReimagineMap,
  coLocatedPartyNpcs = [],
  onOverrideLocation,
  isOverriding = false,
  onSaveCampaignLocationLore,
  onSaveCampaignContainerLore,
  unlockLore = false,
  revealedLoreIds = [],
  onToggleLoreReveal,
  revealedEdgeIds = [],
  onToggleEdgeReveal,
  revealedPropIds = [],
  worldArtifactLore = [],
  propTransferTargets,
  onSaveCampaignLocationProps,
  onTogglePropReveal,
  onTransferProp,
  isMutatingLocked = false,
  initialContainerFocus = "active",
  externalFocusRequest = null,
  worldMedia = [],
  visitedContainerIds = [],
  onOpenMechanicsHelp,
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
  const baselineSecretEdgeIds = useMemo(
    () =>
      new Set(
        propEdges
          .filter((e) => e.is_secret && !e.id.startsWith("new_"))
          .map((e) => e.id)
      ),
    [propEdges]
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

  const propBaseline = useMemo<GraphSnapshot>(
    () => ({
      containers: propContainers,
      locations: propLocations,
      edges: propEdges,
    }),
    [propContainers, propLocations, propEdges]
  );

  interface AutoLayoutPreviewState {
    containerId: string | null;
    coords: Record<string, { x: number; y: number }>;
    ghostCoords: Record<string, { x: number; y: number }>;
    priorPan: { x: number; y: number };
    priorZoom: number;
  }
  interface ReconcilePreviewState {
    containerId: string | null;
    adjustments: ReconciliationAdjustment[];
    byEdgeId: Record<string, ReconciliationAdjustment>;
  }
  const [autoLayoutPreview, setAutoLayoutPreview] =
    useState<AutoLayoutPreviewState | null>(null);
  const [reconcilePreview, setReconcilePreview] =
    useState<ReconcilePreviewState | null>(null);
  const [isConsistencyPanelOpen, setIsConsistencyPanelOpen] = useState(false);
  const [autoSyncConsistency, setAutoSyncConsistency] = useState(false);
  const canInspectConsistency = mode === "editor" || unlockLore;
  const canAutoLayout = (mode === "editor" || unlockLore) && !isMutatingLocked;
  const isPreviewingAutoLayout = autoLayoutPreview !== null;
  const effectiveMutatingLocked =
    isMutatingLocked || isPreviewingAutoLayout || Boolean(reconcilePreview);

  useEffect(() => {
    if (!canInspectConsistency) {
      setIsConsistencyPanelOpen(false);
      setReconcilePreview(null);
    }
  }, [canInspectConsistency]);

  const commitNextGraph = useCallback(
    (next: GraphSnapshot, pushUndo = true) => {
      if (pushUndo) {
        const snapshotBefore = cloneGraph(
          workingContainers,
          workingLocations,
          workingEdges
        );
        setUndoStack((prev) => [...prev.slice(-49), snapshotBefore]);
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
    if (undoStack.length === 0 || effectiveMutatingLocked) return;
    const prev = undoStack[undoStack.length - 1];
    const nextStack = undoStack.slice(0, -1);
    setUndoStack(nextStack);
    setInlineEdgeEdit(null);
    setContextMenu(null);
    if (isControlledExternally && onChangeGraph) {
      onChangeGraph(prev);
    } else {
      setDraft(prev);
      setInternalDirty(!areGraphSnapshotsEqual(prev, propBaseline));
    }
    setStatusNotice("Reverted last map action.");
  }, [
    undoStack,
    effectiveMutatingLocked,
    isControlledExternally,
    onChangeGraph,
    propBaseline,
  ]);

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
  const [selectedEdgeState, setSelectedEdgeState] =
    useState<SelectedEdgeState | null>(null);
  const selectEdgePair = useCallback(
    (edgeId: string, returnBundleEdgeIds?: string[]) => {
      setSelectedLocId(null);
      setSelectedContainerId(null);
      setSelectedGhostLocId(null);
      setInlineEdgeEdit(null);
      setContextMenu(null);
      setSelectedEdgeState({ kind: "pair", edgeId, returnBundleEdgeIds });
    },
    []
  );
  const selectEdgeBundle = useCallback(
    (edgeIds: string[]) => {
      setSelectedLocId(null);
      setSelectedContainerId(null);
      setSelectedGhostLocId(null);
      setInlineEdgeEdit(null);
      setContextMenu(null);
      const pairs = resolveBundleLinkPairs(edgeIds, workingEdges);
      if (pairs.length === 1) {
        setSelectedEdgeState({ kind: "pair", edgeId: pairs[0].primary.id });
      } else if (pairs.length > 1) {
        setSelectedEdgeState({ kind: "bundle", edgeIds });
      }
    },
    [workingEdges]
  );
  const clearAllSelection = useCallback(() => {
    setSelectedLocId(null);
    setSelectedContainerId(null);
    setSelectedGhostLocId(null);
    setSelectedEdgeState(null);
  }, []);
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
  const [portReassignDrag, setPortReassignDrag] =
    useState<PortReassignDragState | null>(null);

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

  const topologyRootRef = useRef<HTMLDivElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewportGroupRef = useRef<SVGGElement | null>(null);

  const pendingSaveSelectionRef = useRef<{
    selectedLoc: { name: string; container_id: string | null } | null;
    selectedCont: { name: string; parent_container_id: string | null; depth: number } | null;
    currentCont: { name: string; parent_container_id: string | null; depth: number } | null;
  } | null>(null);

  // Keep container selection valid if deleted, reconciling server-assigned IDs after stay-open save
  useEffect(() => {
    if (
      currentContainerId &&
      !workingContainers.some((c) => c.id === currentContainerId)
    ) {
      const snap = pendingSaveSelectionRef.current?.currentCont;
      const matched = snap
        ? workingContainers.find(
            (c) =>
              c.name === snap.name &&
              c.depth === snap.depth &&
              (c.parent_container_id ?? null) === snap.parent_container_id
          )
        : undefined;
      setCurrentContainerId(matched ? matched.id : null);
    }
  }, [workingContainers, currentContainerId]);

  useEffect(() => {
    if (
      selectedContainerId &&
      !workingContainers.some((c) => c.id === selectedContainerId)
    ) {
      const snap = pendingSaveSelectionRef.current?.selectedCont;
      const matched = snap
        ? workingContainers.find(
            (c) =>
              c.name === snap.name &&
              c.depth === snap.depth &&
              (c.parent_container_id ?? null) === snap.parent_container_id
          )
        : undefined;
      setSelectedContainerId(matched ? matched.id : null);
    }
  }, [workingContainers, selectedContainerId]);

  useEffect(() => {
    if (
      selectedLocId &&
      !workingLocations.some((l) => l.id === selectedLocId)
    ) {
      const snap = pendingSaveSelectionRef.current?.selectedLoc;
      const matched = snap
        ? workingLocations.find(
            (l) =>
              l.name === snap.name &&
              (l.container_id ?? null) === snap.container_id
          )
        : undefined;
      setSelectedLocId(matched ? matched.id : null);
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

  useEffect(() => {
    if (selectedLocId || selectedContainerId || selectedGhostLocId) {
      setSelectedEdgeState(null);
    }
  }, [selectedLocId, selectedContainerId, selectedGhostLocId]);

  useEffect(() => {
    if (!selectedEdgeState) return;
    if (selectedEdgeState.kind === "pair") {
      if (!resolveLinkPairForInspector(selectedEdgeState.edgeId, workingEdges)) {
        setSelectedEdgeState(null);
      } else if (selectedEdgeState.returnBundleEdgeIds) {
        const nextPairs = resolveBundleLinkPairs(
          selectedEdgeState.returnBundleEdgeIds,
          workingEdges
        );
        if (nextPairs.length <= 1) {
          setSelectedEdgeState({ kind: "pair", edgeId: selectedEdgeState.edgeId });
        }
      }
      return;
    }
    const nextPairs = resolveBundleLinkPairs(
      selectedEdgeState.edgeIds,
      workingEdges
    );
    if (nextPairs.length === 0) {
      setSelectedEdgeState(null);
    } else if (nextPairs.length === 1) {
      setSelectedEdgeState({ kind: "pair", edgeId: nextPairs[0].primary.id });
    }
  }, [workingEdges, selectedEdgeState]);

  const activeLoc = useMemo(
    () =>
      workingLocations.find((l) => l.id === activeLocationId) ??
      workingLocations.find((l) => l.is_starting_location) ??
      workingLocations[0],
    [workingLocations, activeLocationId]
  );

  const selectedLocation = useMemo(
    () =>
      !selectedContainerId &&
      !selectedGhostLocId &&
      !selectedEdgeState &&
      selectedLocId
        ? workingLocations.find((l) => l.id === selectedLocId) ?? null
        : null,
    [
      workingLocations,
      selectedLocId,
      selectedContainerId,
      selectedGhostLocId,
      selectedEdgeState,
    ]
  );

  const selectedEdgePair = useMemo<LinkPairInspectorData | null>(() => {
    if (selectedEdgeState?.kind !== "pair") return null;
    return resolveLinkPairForInspector(selectedEdgeState.edgeId, workingEdges);
  }, [selectedEdgeState, workingEdges]);

  const selectedEdgeBundle = useMemo<LinkPairInspectorData[] | null>(() => {
    if (selectedEdgeState?.kind !== "bundle") return null;
    const pairs = resolveBundleLinkPairs(selectedEdgeState.edgeIds, workingEdges);
    return pairs.length > 0 ? pairs : null;
  }, [selectedEdgeState, workingEdges]);

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
        presentCharacterLocations,
        { mode, unlockLore, revealedEdgeIds }
      ),
    [
      currentContainerId,
      workingContainers,
      workingLocations,
      workingEdges,
      activeLoc?.id,
      presentCharacterLocations,
      mode,
      unlockLore,
      revealedEdgeIds,
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

  // Global validation reports (Reachability + Container invariants).
  // In Campaign Player Mode, undiscovered secret links are omitted from visible_edges,
  // so pre-existing locations linked only via hidden secrets are excluded here;
  // backend campaign_map_update enforces reachability after restoring omitted secrets.
  const initialHiddenLinkedLocIds = useMemo(() => {
    if (mode !== "campaign" || unlockLore) return new Set<string>();
    const initialReport = computeUnreachableLocationIds(propLocations, propEdges);
    return new Set(
      initialReport.unreachableIds.filter((id) => !id.startsWith("new_"))
    );
  }, [mode, unlockLore, propLocations, propEdges]);

  const rawReachabilityReport = useMemo(
    () => computeUnreachableLocationIds(workingLocations, workingEdges),
    [workingLocations, workingEdges]
  );
  const reachabilityReport = useMemo(() => {
    if (initialHiddenLinkedLocIds.size === 0) return rawReachabilityReport;
    return {
      ...rawReachabilityReport,
      unreachableIds: rawReachabilityReport.unreachableIds.filter(
        (id) => !initialHiddenLinkedLocIds.has(id)
      ),
    };
  }, [rawReachabilityReport, initialHiddenLinkedLocIds]);
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

  const consistencyReport = useMemo(() => {
    if (!canInspectConsistency) {
      return {
        scopeContainerId: currentContainerId,
        diagnostics: [],
        diagnosticsByEdgeId: {},
        anchorResolutions: {},
        proposedAdjustments: [],
        proposedByEdgeId: {},
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
      };
    }
    return analyzeSpatialConsistency({
      scopeContainerId: currentContainerId,
      containers: workingContainers,
      locations: workingLocations,
      edges: workingEdges,
      options: { mode, unlockLore, revealedEdgeIds },
    });
  }, [
    canInspectConsistency,
    currentContainerId,
    workingContainers,
    workingLocations,
    workingEdges,
    mode,
    unlockLore,
    revealedEdgeIds,
  ]);

  const worldConsistencySummary = useMemo(() => {
    if (!canInspectConsistency) {
      return {
        totalErrors: 0,
        totalWarnings: 0,
        totalInfos: 0,
        byScope: [],
        allDiagnostics: [],
        allProposedAdjustments: [],
      };
    }
    return analyzeWorldConsistencySummary({
      containers: workingContainers,
      locations: workingLocations,
      edges: workingEdges,
      options: { mode, unlockLore, revealedEdgeIds },
    });
  }, [
    canInspectConsistency,
    workingContainers,
    workingLocations,
    workingEdges,
    mode,
    unlockLore,
    revealedEdgeIds,
  ]);

  const settledFullMapCoords = useMemo(() => {
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
    return computeFullMapCoords(
      pseudoNodes,
      pseudoEdges,
      projectedTopology.anchorNodeId
    );
  }, [projectedTopology]);

  const fullMapCoords = useMemo(() => {
    if (autoLayoutPreview) {
      return autoLayoutPreview.coords;
    }
    if (nodeDrag && nodeDrag.hasMoved && nodeDrag.kind !== "ghost") {
      return {
        ...settledFullMapCoords,
        [nodeDrag.id]: { x: nodeDrag.currX, y: nodeDrag.currY },
      };
    }
    return settledFullMapCoords;
  }, [autoLayoutPreview, settledFullMapCoords, nodeDrag]);

  const visibleFootprints = useMemo(() => {
    const map: Record<string, { halfW: number; halfH: number }> = {};
    for (const loc of projectedTopology.visibleLocations) {
      map[loc.id] = { halfW: 54, halfH: 34 };
    }
    for (const sn of projectedTopology.visibleSupernodes) {
      map[sn.container.id] = {
        halfW: CONTAINER_CARD_HALF_W + 6,
        halfH: CONTAINER_CARD_HALF_H + 8,
      };
    }
    return map;
  }, [projectedTopology.visibleLocations, projectedTopology.visibleSupernodes]);

  const currentScopeContainer = currentContainerId
    ? containerMap.get(currentContainerId) ?? null
    : null;
  const currentGhostOverrides = currentScopeContainer?.ghost_coords;

  const ghostCoords = useMemo(() => {
    if (autoLayoutPreview) {
      return autoLayoutPreview.ghostCoords;
    }
    const computed = computeGhostNodeCoords(
      projectedTopology.ghostExternalNodes,
      projectedTopology.ghostEdges,
      settledFullMapCoords,
      currentGhostOverrides,
      visibleFootprints
    );
    if (nodeDrag && nodeDrag.hasMoved && nodeDrag.kind === "ghost") {
      computed[nodeDrag.id] = { x: nodeDrag.currX, y: nodeDrag.currY };
    }
    return computed;
  }, [
    autoLayoutPreview,
    projectedTopology.ghostExternalNodes,
    projectedTopology.ghostEdges,
    settledFullMapCoords,
    currentGhostOverrides,
    visibleFootprints,
    nodeDrag,
  ]);

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
    setAutoLayoutPreview(null);
    setReconcilePreview(null);
    setIsConsistencyPanelOpen(false);
    setPendingCenterTarget(null);
    setCurrentContainerId(contId);
    setSelectedContainerId(null);
    setSelectedGhostLocId(null);
    setSelectedEdgeState(null);
    setContextMenu(null);
    setInlineEdgeEdit(null);
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }, []);

  const handleJumpToContainer = useCallback(
    (targetContainerId: string | null, focusLocId?: string) => {
      setAutoLayoutPreview(null);
      setReconcilePreview(null);
      setIsConsistencyPanelOpen(false);
      setCurrentContainerId(targetContainerId);
      setSelectedContainerId(null);
      setSelectedGhostLocId(null);
      setSelectedEdgeState(null);
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
    setSelectedGhostLocId(null);
    setSelectedEdgeState(null);
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
    setSelectedEdgeState(null);
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
    canDeleteEdge,
    handleDeleteLocation,
    handleDeleteContainer,
    handleConvertLocationToContainer,
    handleSetStartingLocation,
    handlePatchEdgePair,
    handleReassignEdgeSlot,
    handleUpdateEdgeDistance,
    handleToggleEdgeBlocked,
    handleToggleEdgeSecret,
    handleDeleteEdge,
    handleDeleteEdgeGroup,
    applyReconciliationAdjustments,
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
    isMutatingLocked: effectiveMutatingLocked,
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
    onEdgesRemoved: (removedIds) => {
      setInlineEdgeEdit((prev) =>
        prev && removedIds.has(prev.edgeId) ? null : prev
      );
      setSelectedEdgeState((prev) => {
        if (!prev) return null;
        if (prev.kind === "pair" && removedIds.has(prev.edgeId)) {
          return prev.returnBundleEdgeIds?.some((id) => !removedIds.has(id))
            ? {
                kind: "bundle",
                edgeIds: prev.returnBundleEdgeIds.filter(
                  (id) => !removedIds.has(id)
                ),
              }
            : null;
        }
        if (prev.kind === "bundle") {
          const remaining = prev.edgeIds.filter((id) => !removedIds.has(id));
          return remaining.length > 0
            ? { kind: "bundle", edgeIds: remaining }
            : null;
        }
        return prev;
      });
    },
    setPromotionPrompt,
    autoSyncConsistency: canInspectConsistency && autoSyncConsistency,
    unlockLore,
    revealedEdgeIds,
  });

  const handleMoveGhostNode = useCallback(
    (externalLocId: string, x: number, y: number) => {
      if (!currentContainerId || effectiveMutatingLocked) return;
      const targetCont = containerMap.get(currentContainerId);
      if (!targetCont) return;
      const roundedX = Math.round(x);
      const roundedY = Math.round(y);
      const prevCoord = targetCont.ghost_coords?.[externalLocId];
      if (
        prevCoord &&
        Math.round(prevCoord.x) === roundedX &&
        Math.round(prevCoord.y) === roundedY
      ) {
        return;
      }
      patchContainer(
        currentContainerId,
        {
          ghost_coords: {
            ...(targetCont.ghost_coords ?? {}),
            [externalLocId]: { x: roundedX, y: roundedY },
          },
        },
        true
      );
    },
    [currentContainerId, effectiveMutatingLocked, containerMap, patchContainer]
  );

  const handleResetGhostCoords = useCallback(
    (externalLocId: string) => {
      if (!currentContainerId || effectiveMutatingLocked) return;
      const targetCont = containerMap.get(currentContainerId);
      if (!targetCont?.ghost_coords?.[externalLocId]) return;
      const { [externalLocId]: _removed, ...rest } = targetCont.ghost_coords;
      patchContainer(currentContainerId, { ghost_coords: rest }, true);
    },
    [currentContainerId, effectiveMutatingLocked, containerMap, patchContainer]
  );

  const emptyCanvasSourceLoc = useMemo(() => {
    if (!emptyCanvasModal) return null;
    return resolveNodeConnectionEndpoint({
      kind: emptyCanvasModal.sourceKind,
      id: emptyCanvasModal.sourceId,
      locationMap,
      containerMap,
      workingContainers,
      workingLocations,
      dynamicPortalIds: projectedTopology.dynamicPortalIds,
    }).loc;
  }, [
    emptyCanvasModal,
    locationMap,
    containerMap,
    workingContainers,
    workingLocations,
    projectedTopology.dynamicPortalIds,
  ]);

  const emptyCanvasSourceOccupiedPorts = useMemo(() => {
    if (!emptyCanvasSourceLoc) return new Map<CompassDirection, string>();
    return getLocationOccupiedPorts(
      emptyCanvasSourceLoc.id,
      workingEdges,
      locationMap
    );
  }, [emptyCanvasSourceLoc, workingEdges, locationMap]);

  const emptyCanvasExistingTargets = useMemo<ExistingLinkTargetOption[]>(() => {
    if (!emptyCanvasSourceLoc) return [];
    const sourceLoc = emptyCanvasSourceLoc;
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
    emptyCanvasSourceLoc,
    locationMap,
    workingContainers,
    workingLocations,
    workingEdges,
    projectedTopology.dynamicPortalIds,
  ]);

  const handleSuggestExistingLink = useCallback(
    (targetLocationId: string) => {
      if (!emptyCanvasModal || !emptyCanvasSourceLoc) return null;
      const targetOccupied = getLocationOccupiedPorts(
        targetLocationId,
        workingEdges,
        locationMap
      );
      if (!canInspectConsistency) return null;
      return suggestExistingLinkGeometry({
        fromLocationId: emptyCanvasSourceLoc.id,
        toLocationId: targetLocationId,
        draggedSourceSlot: emptyCanvasModal.sourceSlot,
        sourceOccupiedPorts: new Set(emptyCanvasSourceOccupiedPorts.keys()),
        targetOccupiedPorts: new Set(targetOccupied.keys()),
        scopeContainerId: currentContainerId,
        containers: workingContainers,
        locations: workingLocations,
        edges: workingEdges,
        options: { mode, unlockLore, revealedEdgeIds },
      });
    },
    [
      canInspectConsistency,
      emptyCanvasModal,
      emptyCanvasSourceLoc,
      emptyCanvasSourceOccupiedPorts,
      workingEdges,
      locationMap,
      currentContainerId,
      workingContainers,
      workingLocations,
      mode,
      unlockLore,
      revealedEdgeIds,
    ]
  );

  const handleSuggestPortalLinkGeometry = useCallback(
    (fromLocId: string, toLocId: string, direction: CompassDirection) => {
      if (!canInspectConsistency) return null;
      const srcOcc = getLocationOccupiedPorts(fromLocId, workingEdges, locationMap);
      const tgtOcc = getLocationOccupiedPorts(toLocId, workingEdges, locationMap);
      return suggestExistingLinkGeometry({
        fromLocationId: fromLocId,
        toLocationId: toLocId,
        draggedSourceSlot: direction,
        sourceOccupiedPorts: new Set(srcOcc.keys()),
        targetOccupiedPorts: new Set(tgtOcc.keys()),
        scopeContainerId: currentContainerId,
        containers: workingContainers,
        locations: workingLocations,
        edges: workingEdges,
        options: { mode, unlockLore, revealedEdgeIds },
      });
    },
    [
      canInspectConsistency,
      workingEdges,
      locationMap,
      currentContainerId,
      workingContainers,
      workingLocations,
      mode,
      unlockLore,
      revealedEdgeIds,
    ]
  );

  useTopologyPointerDrag({
    nodeDrag,
    setNodeDrag,
    linkDrag,
    setLinkDrag,
    portReassignDrag,
    setPortReassignDrag,
    occupiedSlotsByLocId,
    onReassignEdgeSlot: handleReassignEdgeSlot,
    onSelectEdgePair: selectEdgePair,
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

  const hasAutoLayoutTargets =
    projectedTopology.visibleLocations.length +
      projectedTopology.visibleSupernodes.length >=
      2 || projectedTopology.ghostExternalNodes.length > 0;

  const handleStartAutoLayoutPreview = useCallback(() => {
    if (!canAutoLayout || !hasAutoLayoutTargets || effectiveSaving) return;
    const { coords, ghostCoords: nextGhostCoords } = computeScopedAutoLayout({
      projectedTopology,
      footprints: visibleFootprints,
    });
    const wrapRect = canvasWrapRef.current?.getBoundingClientRect();
    const viewBox = computeResponsiveViewBox(
      wrapRect?.width ?? 0,
      wrapRect?.height ?? 0
    );
    const fit = computeViewportFitForCoords({
      coords,
      ghostCoords: nextGhostCoords,
      footprints: visibleFootprints,
      viewBox,
      isMobileViewport,
    });
    setContextMenu(null);
    setInlineEdgeEdit(null);
    setStatusNotice(null);
    setNodeDrag(null);
    setLinkDrag(null);
    setPortReassignDrag(null);
    setReconcilePreview(null);
    setIsConsistencyPanelOpen(false);
    setAutoLayoutPreview((prev) => ({
      containerId: currentContainerId,
      coords,
      ghostCoords: nextGhostCoords,
      priorPan: prev ? prev.priorPan : { ...pan },
      priorZoom: prev ? prev.priorZoom : zoom,
    }));
    setPan(fit.pan);
    setZoom(fit.zoom);
  }, [
    canAutoLayout,
    hasAutoLayoutTargets,
    effectiveSaving,
    projectedTopology,
    visibleFootprints,
    isMobileViewport,
    currentContainerId,
    pan,
    zoom,
  ]);

  const handleResetAutoLayoutPreview = useCallback(() => {
    if (!autoLayoutPreview) return;
    setPan(autoLayoutPreview.priorPan);
    setZoom(autoLayoutPreview.priorZoom);
    setAutoLayoutPreview(null);
  }, [autoLayoutPreview]);

  const handleApplyAutoLayoutPreview = useCallback(() => {
    if (!autoLayoutPreview || !canAutoLayout) return;
    const nextGraph = cloneGraph(
      workingContainers,
      workingLocations,
      workingEdges
    );
    for (const loc of nextGraph.locations) {
      if (Object.prototype.hasOwnProperty.call(autoLayoutPreview.coords, loc.id)) {
        const pt = autoLayoutPreview.coords[loc.id];
        loc.ui_x = pt.x;
        loc.ui_y = pt.y;
      }
    }
    for (const cont of nextGraph.containers) {
      if (Object.prototype.hasOwnProperty.call(autoLayoutPreview.coords, cont.id)) {
        const pt = autoLayoutPreview.coords[cont.id];
        cont.ui_x = pt.x;
        cont.ui_y = pt.y;
      }
      if (currentContainerId !== null && cont.id === currentContainerId) {
        cont.ghost_coords = {};
      }
    }
    commitNextGraph(nextGraph, true);
    setAutoLayoutPreview(null);
    setStatusNotice("Applied auto-layout to current view. Save Map to persist.");
  }, [
    autoLayoutPreview,
    canAutoLayout,
    workingContainers,
    workingLocations,
    workingEdges,
    currentContainerId,
    commitNextGraph,
  ]);

  useEffect(() => {
    if (!autoLayoutPreview) return;
    if (!canAutoLayout) {
      setPan(autoLayoutPreview.priorPan);
      setZoom(autoLayoutPreview.priorZoom);
      setAutoLayoutPreview(null);
      return;
    }
    if (autoLayoutPreview.containerId !== currentContainerId) {
      setAutoLayoutPreview(null);
    }
  }, [autoLayoutPreview, canAutoLayout, currentContainerId]);

  useEffect(() => {
    if (reconcilePreview && reconcilePreview.containerId !== currentContainerId) {
      setReconcilePreview(null);
    }
  }, [reconcilePreview, currentContainerId]);

  const handleStartReconcilePreview = useCallback(() => {
    if (
      isMutatingLocked ||
      consistencyReport.proposedAdjustments.length === 0
    ) {
      return;
    }
    if (autoLayoutPreview) {
      setPan(autoLayoutPreview.priorPan);
      setZoom(autoLayoutPreview.priorZoom);
      setAutoLayoutPreview(null);
    }
    setIsConsistencyPanelOpen(false);
    setContextMenu(null);
    setInlineEdgeEdit(null);
    setReconcilePreview({
      containerId: currentContainerId,
      adjustments: consistencyReport.proposedAdjustments,
      byEdgeId: consistencyReport.proposedByEdgeId,
    });
  }, [
    isMutatingLocked,
    consistencyReport,
    autoLayoutPreview,
    currentContainerId,
  ]);

  const handleApplyReconcilePreview = useCallback(() => {
    if (!reconcilePreview || isMutatingLocked) return;
    applyReconciliationAdjustments(reconcilePreview.adjustments);
    setReconcilePreview(null);
  }, [reconcilePreview, isMutatingLocked, applyReconciliationAdjustments]);

  const handleCancelReconcilePreview = useCallback(() => {
    setReconcilePreview(null);
  }, []);

  const handleApplySingleAdjustment = useCallback(
    (adj: ReconciliationAdjustment) => {
      if (effectiveMutatingLocked) return;
      applyReconciliationAdjustments([adj]);
    },
    [effectiveMutatingLocked, applyReconciliationAdjustments]
  );

  const handleMarkNonEuclidean = useCallback(
    (edgeId: string) => {
      if (effectiveMutatingLocked) return;
      handlePatchEdgePair(edgeId, { distance_mode: "non_euclidean" });
    },
    [effectiveMutatingLocked, handlePatchEdgePair]
  );

  const handleJumpToDiagnostic = useCallback(
    (diag: EdgeConsistencyDiagnostic) => {
      setIsConsistencyPanelOpen(false);
      if (
        diag.kind === "anchor_invalid" ||
        diag.kind === "anchor_disconnected"
      ) {
        if (diag.scopeContainerId !== currentContainerId) {
          handleJumpToContainer(diag.scopeContainerId, diag.fromLocationId);
        } else {
          setSelectedContainerId(null);
          setSelectedGhostLocId(null);
          setSelectedEdgeState(null);
          setSelectedLocId(diag.fromLocationId);
        }
        return;
      }
      if (diag.scopeContainerId !== currentContainerId) {
        handleJumpToContainer(diag.scopeContainerId);
      }
      selectEdgePair(diag.primaryEdgeId);
    },
    [currentContainerId, handleJumpToContainer, selectEdgePair]
  );

  const capturePendingSelectionSnapshot = () => {
    const selLoc = selectedLocId
      ? workingLocations.find((l) => l.id === selectedLocId) ?? null
      : null;
    const selCont = selectedContainerId
      ? workingContainers.find((c) => c.id === selectedContainerId) ?? null
      : null;
    const curCont = currentContainerId
      ? workingContainers.find((c) => c.id === currentContainerId) ?? null
      : null;
    pendingSaveSelectionRef.current = {
      selectedLoc: selLoc
        ? { name: selLoc.name, container_id: selLoc.container_id ?? null }
        : null,
      selectedCont: selCont
        ? {
            name: selCont.name,
            parent_container_id: selCont.parent_container_id ?? null,
            depth: selCont.depth,
          }
        : null,
      currentCont: curCont
        ? {
            name: curCont.name,
            parent_container_id: curCont.parent_container_id ?? null,
            depth: curCont.depth,
          }
        : null,
    };
  };

  const runMapPersist = async (
    persistFn: (graph: GraphSnapshot) => Promise<boolean | void> | boolean | void
  ): Promise<boolean> => {
    if (effectiveMutatingLocked || hasBlockingErrors || effectiveSaving) {
      return false;
    }
    capturePendingSelectionSnapshot();
    setInternalSaving(true);
    setSaveError(null);
    try {
      const result = await persistFn(
        cloneGraph(workingContainers, workingLocations, workingEdges)
      );
      if (result === false) {
        return false;
      }
      if (!isControlledExternally) {
        setInternalDirty(false);
        setUndoStack([]);
      }
      setStatusNotice("Map saved.");
      return true;
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setInternalSaving(false);
    }
  };

  const handleSaveClick = async (): Promise<boolean> => {
    if (!onSaveMap) return false;
    return runMapPersist(onSaveMap);
  };

  const canSaveAndClose = Boolean(onSaveAndCloseMap || onRequestClose || onClose);

  const handleSaveAndCloseClick = async (): Promise<void> => {
    if (onSaveAndCloseMap) {
      await runMapPersist(onSaveAndCloseMap);
      return;
    }
    const saved = await handleSaveClick();
    if (saved) {
      (onRequestClose ?? onClose)?.();
    }
  };

  // Global Delete-key removal for selected location, hub, container, or link pair (Undo-backed)
  const hasBlockingOverlayOpen = Boolean(
    inlineEdgeEdit ||
      contextMenu ||
      hubCollisionModal ||
      emptyCanvasModal ||
      groupModal ||
      standaloneContainerModal ||
      promotionPrompt ||
      iconBrowserTarget
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !e.repeat &&
        (isConsistencyPanelOpen || Boolean(reconcilePreview)) &&
        !hasBlockingOverlayOpen &&
        !isEditableKeyboardTarget(e.target, topologyRootRef.current) &&
        !isEditableKeyboardTarget(
          typeof document !== "undefined" ? document.activeElement : null,
          topologyRootRef.current
        )
      ) {
        e.preventDefault();
        if (isConsistencyPanelOpen) setIsConsistencyPanelOpen(false);
        if (reconcilePreview) setReconcilePreview(null);
        return;
      }
      if (
        e.key === "Escape" &&
        !e.repeat &&
        isPreviewingAutoLayout &&
        !hasBlockingOverlayOpen &&
        !isEditableKeyboardTarget(e.target, topologyRootRef.current) &&
        !isEditableKeyboardTarget(
          typeof document !== "undefined" ? document.activeElement : null,
          topologyRootRef.current
        )
      ) {
        e.preventDefault();
        handleResetAutoLayoutPreview();
        return;
      }
      if (effectiveMutatingLocked || effectiveSaving || hasBlockingOverlayOpen) {
        return;
      }
      if (
        isEditableKeyboardTarget(e.target, topologyRootRef.current) ||
        isEditableKeyboardTarget(
          typeof document !== "undefined" ? document.activeElement : null,
          topologyRootRef.current
        )
      ) {
        return;
      }

      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === "z" &&
        !e.repeat
      ) {
        if (undoStack.length > 0) {
          e.preventDefault();
          handleUndo();
        }
        return;
      }

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

      if (selectedEdgeState?.kind === "pair") {
        e.preventDefault();
        const check = canDeleteEdge(selectedEdgeState.edgeId);
        if (!check.allowed) {
          if (check.reason) setStatusNotice(check.reason);
          return;
        }
        handleDeleteEdge(selectedEdgeState.edgeId);
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
    effectiveMutatingLocked,
    isPreviewingAutoLayout,
    handleResetAutoLayoutPreview,
    effectiveSaving,
    hasBlockingOverlayOpen,
    selectedEdgeState,
    selectedGhostLocId,
    selectedContainerId,
    selectedLocId,
    canDeleteEdge,
    canDeleteContainer,
    canDeleteLocation,
    handleDeleteEdge,
    handleDeleteContainer,
    handleDeleteLocation,
    undoStack.length,
    handleUndo,
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
    if (effectiveMutatingLocked) return;
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

  const openEdgeInDrawer = useCallback(
    (edgeId: string, groupedEdgeIds?: string[]) => {
      if (groupedEdgeIds && groupedEdgeIds.length > 0) {
        const pairs = resolveBundleLinkPairs(groupedEdgeIds, workingEdges);
        if (pairs.length > 1) {
          selectEdgeBundle(groupedEdgeIds);
          return;
        }
      }
      selectEdgePair(edgeId);
    },
    [workingEdges, selectEdgeBundle, selectEdgePair]
  );

  const selectedExternalPortals = useMemo(() => {
    if (!selectedLocation) return [];
    const revealedIdSet = new Set(revealedEdgeIds);
    const revealedPairs = resolveRevealedEdgePairs(workingEdges, revealedEdgeIds);
    return (projectedTopology.externalPortalsByLocationId[selectedLocation.id] ?? []).map(
      (ext) => ({
        edgeId: ext.edge.id,
        destinationName: ext.destination.name,
        destinationContainerName: ext.destinationContainerName ?? "World Root",
        directionLabel: ext.edge.direction_label,
        compassDirection: ext.edge.compass_direction,
        distanceMeters: ext.edge.distance_meters,
        speedModifier: ext.edge.speed_modifier,
        travelMode: ext.edge.travel_mode ?? null,
        obstacles: ext.edge.obstacles ?? [],
        isBlocked: Boolean(ext.edge.is_blocked),
        isSecret: Boolean(ext.edge.is_secret),
        isUndiscoveredSecret: Boolean(
          ext.edge.is_secret &&
            (mode !== "campaign" ||
              !isEdgeRevealed(ext.edge, revealedIdSet, revealedPairs))
        ),
      })
    );
  }, [
    selectedLocation,
    projectedTopology.externalPortalsByLocationId,
    workingEdges,
    revealedEdgeIds,
    mode,
  ]);

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
    selectedLocation ||
      selectedContainer ||
      selectedGhost ||
      selectedEdgePair ||
      (selectedEdgeBundle && selectedEdgeBundle.length > 0)
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
      ref={topologyRootRef}
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
        if (isConsistencyPanelOpen) setIsConsistencyPanelOpen(false);
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
        isMutatingLocked={effectiveMutatingLocked}
        validationSummary={validationSummary}
        handleSaveClick={handleSaveClick}
        handleSaveAndCloseClick={
          canSaveAndClose ? handleSaveAndCloseClick : undefined
        }
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
        canAutoLayout={canAutoLayout}
        autoLayoutDisabled={!hasAutoLayoutTargets}
        isAutoLayoutPreviewing={isPreviewingAutoLayout}
        onPreviewAutoLayout={handleStartAutoLayoutPreview}
        consistencyIssueCount={
          canInspectConsistency
            ? worldConsistencySummary.totalErrors +
              worldConsistencySummary.totalWarnings +
              worldConsistencySummary.totalInfos
            : 0
        }
        consistencyErrorCount={
          canInspectConsistency ? worldConsistencySummary.totalErrors : 0
        }
        isConsistencyPanelOpen={canInspectConsistency && isConsistencyPanelOpen}
        onToggleConsistencyPanel={
          canInspectConsistency
            ? () => setIsConsistencyPanelOpen((prev) => !prev)
            : undefined
        }
        consistencyPopover={
          canInspectConsistency ? (
            <MapConsistencyPanel
              isOpen={isConsistencyPanelOpen}
              currentContainerId={currentContainerId}
              currentReport={consistencyReport}
              worldSummary={worldConsistencySummary}
              isMutatingLocked={effectiveMutatingLocked}
              isPreviewingReconcile={Boolean(reconcilePreview)}
              autoSyncEnabled={autoSyncConsistency}
              onToggleAutoSync={setAutoSyncConsistency}
              onStartReconcilePreview={handleStartReconcilePreview}
              onApplySingleAdjustment={handleApplySingleAdjustment}
              onMarkNonEuclidean={handleMarkNonEuclidean}
              onJumpToDiagnostic={handleJumpToDiagnostic}
              onClose={() => setIsConsistencyPanelOpen(false)}
            />
          ) : null
        }
      />

      {/* Draggable Node Palette Bar + Undo + Validation Status */}
      <MapPaletteBar
        canAddContainerHere={canAddContainerHere}
        isMutatingLocked={isMutatingLocked}
        isReadOnlyPreview={isPreviewingAutoLayout}
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
            if (effectiveMutatingLocked) return;
            if (e.dataTransfer.types.includes(PALETTE_DRAG_MIME)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
            }
          }}
          onDrop={(e) => {
            if (effectiveMutatingLocked) return;
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
            portReassignDrag={portReassignDrag}
            setPortReassignDrag={setPortReassignDrag}
            hoveredNodeKey={hoveredNodeKey}
            setHoveredNodeKey={setHoveredNodeKey}
            projectedTopology={projectedTopology}
            workingEdges={workingEdges}
            locationMap={locationMap}
            fullMapCoords={fullMapCoords}
            ghostCoords={ghostCoords}
            selectedContainer={selectedContainer}
            selectedLocation={selectedLocation}
            selectedGhostLocId={selectedGhostLocId}
            activeLoc={activeLoc}
            activeNeighborIds={activeNeighborIds}
            unreachableSet={unreachableSet}
            occupiedSlotsByLocId={occupiedSlotsByLocId}
            isMutatingLocked={effectiveMutatingLocked}
            inlineEdgeEdit={inlineEdgeEdit}
            setInlineEdgeEdit={setInlineEdgeEdit}
            statusNotice={statusNotice}
            setStatusNotice={setStatusNotice}
            setSelectedLocId={setSelectedLocId}
            setSelectedContainerId={setSelectedContainerId}
            setSelectedGhostLocId={setSelectedGhostLocId}
            selectedEdgeState={selectedEdgeState}
            onSelectEdgePair={(edgeId) => selectEdgePair(edgeId)}
            onSelectEdgeBundle={selectEdgeBundle}
            onClearEdgeSelection={() => setSelectedEdgeState(null)}
            setContextMenu={setContextMenu}
            openContextMenuAt={openContextMenuAt}
            handleUpdateEdgeDistance={handleUpdateEdgeDistance}
            handleDeleteEdge={handleDeleteEdge}
            handleDeleteEdgeGroup={handleDeleteEdgeGroup}
            onReassignEdgeSlot={handleReassignEdgeSlot}
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
            isAutoLayoutPreviewing={isPreviewingAutoLayout}
            onApplyAutoLayout={handleApplyAutoLayoutPreview}
            onResetAutoLayout={handleResetAutoLayoutPreview}
            consistencyReport={consistencyReport}
            unlockLore={unlockLore}
            reconcilePreview={reconcilePreview}
            onApplyReconcilePreview={handleApplyReconcilePreview}
            onCancelReconcilePreview={handleCancelReconcilePreview}
          />

          {/* Context Menu & Dialogs */}
          <MapContextMenu
            menu={contextMenu}
            locations={workingLocations}
            containers={workingContainers}
            edges={workingEdges}
            mode={mode}
            unlockLore={unlockLore}
            canDeleteContainer={canDeleteContainer}
            canDeleteLocation={canDeleteLocation}
            canConvertLocation={canConvertLocation}
            canMoveOutToParent={canMoveOutToParent}
            onClose={() => setContextMenu(null)}
            onInspect={(kind, id) => {
              setSelectedEdgeState(null);
              if (kind === "location") {
                setSelectedContainerId(null);
                setSelectedGhostLocId(null);
                setSelectedLocId(id);
              } else {
                setSelectedLocId(null);
                setSelectedGhostLocId(null);
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
                value: String(edge.distance_meters),
              });
            }}
            onInspectEdge={openEdgeInDrawer}
            onToggleEdgeBlocked={handleToggleEdgeBlocked}
            onToggleEdgeSecret={handleToggleEdgeSecret}
            onDeleteEdge={handleDeleteEdge}
            onDeleteEdgeGroup={handleDeleteEdgeGroup}
            onSetLocationAnchor={
              canInspectConsistency
                ? (locId, anchorId) =>
                    patchLocation(locId, { anchor_location_id: anchorId }, true)
                : undefined
            }
          />

          <PassageHubCollisionModal
            state={hubCollisionModal}
            onCancel={() => setHubCollisionModal(null)}
            onConfirm={handleConfirmHubCollision}
          />

          <EmptyCanvasCreateModal
            state={emptyCanvasModal}
            sourceContainerId={emptyCanvasSourceLoc?.container_id ?? null}
            sourceOccupiedPorts={emptyCanvasSourceOccupiedPorts}
            existingTargets={emptyCanvasExistingTargets}
            onSuggestExistingLink={handleSuggestExistingLink}
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

          <PortalPromotionModal
            promotionPrompt={promotionPrompt}
            containerMap={containerMap}
            dynamicPortalIds={projectedTopology.dynamicPortalIds}
            edges={workingEdges}
            locationMap={locationMap}
            onSuggestLinkGeometry={handleSuggestPortalLinkGeometry}
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
                patchContainer(iconBrowserTarget.targetId, { icon: iconKey }, true);
              } else {
                patchLocation(iconBrowserTarget.targetId, { icon: iconKey }, true);
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
              selectedEdgePair={selectedEdgePair}
              selectedEdgeBundle={selectedEdgeBundle}
              returnBundleEdgeIds={
                selectedEdgeState?.kind === "pair"
                  ? selectedEdgeState.returnBundleEdgeIds
                  : undefined
              }
              revealedEdgeIds={revealedEdgeIds}
              allEdges={workingEdges}
              isEdgeSavedSecretInDb={
                selectedEdgePair
                  ? baselineSecretEdgeIds.has(selectedEdgePair.primary.id) ||
                    Boolean(
                      selectedEdgePair.reciprocal &&
                        baselineSecretEdgeIds.has(selectedEdgePair.reciprocal.id)
                    )
                  : false
              }
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
              isMutatingLocked={effectiveMutatingLocked}
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
                  clearAllSelection();
                }
              }}
              onPatchLocation={patchLocation}
              onPatchContainer={patchContainer}
              onPatchEdgePair={handlePatchEdgePair}
              onResetCoordinates={resetCoordinates}
              onResetGhostCoords={handleResetGhostCoords}
              onDeleteEdge={handleDeleteEdge}
              canDeleteEdge={canDeleteEdge}
              onInspectEdgePair={(edgeId, groupedEdgeIds) => {
                if (groupedEdgeIds && groupedEdgeIds.length > 0) {
                  const pairs = resolveBundleLinkPairs(groupedEdgeIds, workingEdges);
                  if (pairs.length > 1) {
                    selectEdgeBundle(groupedEdgeIds);
                    return;
                  }
                }
                selectEdgePair(edgeId);
              }}
              onSelectEdgePair={selectEdgePair}
              onBackToBundle={
                selectedEdgeState?.kind === "pair" &&
                selectedEdgeState.returnBundleEdgeIds &&
                selectedEdgeState.returnBundleEdgeIds.length > 0
                  ? () =>
                      selectEdgeBundle(
                        selectedEdgeState.returnBundleEdgeIds ?? []
                      )
                  : undefined
              }
              onToggleEdgeReveal={onToggleEdgeReveal}
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
              revealedPropIds={revealedPropIds}
              worldArtifactLore={worldArtifactLore}
              propTransferTargets={propTransferTargets}
              onSaveCampaignLocationProps={onSaveCampaignLocationProps}
              onTogglePropReveal={onTogglePropReveal}
              onTransferProp={onTransferProp}
              usedIconKeys={usedMapIconKeys}
              onOpenIconBrowser={(target) => {
                if (!effectiveMutatingLocked) setIconBrowserTarget(target);
              }}
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
              onOpenMechanicsHelp={onOpenMechanicsHelp}
              consistencyReport={consistencyReport}
            />
          ) : null;

          if (isMobileViewport) {
            if (!hasDetailsOpen) return null;

            const peekName = selectedContainer
              ? selectedContainer.name
              : selectedGhost
              ? selectedGhost.destination.name
              : selectedEdgeBundle
              ? `Boundary Passages (${selectedEdgeBundle.length})`
              : selectedEdgePair
              ? `${
                  locationMap.get(selectedEdgePair.primary.from_location_id)?.name ??
                  selectedEdgePair.primary.from_location_id
                } ${selectedEdgePair.reciprocal ? "↔" : "→"} ${
                  locationMap.get(selectedEdgePair.primary.to_location_id)?.name ??
                  selectedEdgePair.primary.to_location_id
                }`
              : selectedLocation?.name ?? "";
            const peekBadge = selectedContainer
              ? `L${selectedContainer.depth}`
              : selectedGhost
              ? "Portal"
              : selectedEdgeBundle
              ? "Bundle"
              : selectedEdgePair
              ? "Link"
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
                        onClick={clearAllSelection}
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
                Click any location, container, link, or external ghost destination to inspect its details.
              </span>
              <span style={{ fontSize: "0.7rem" }}>
                Double-click a container card to enter it, or double-click a link distance badge to edit distance quickly.
              </span>
            </div>
          );
        })()}
      </div>
    </div>
  );
};
