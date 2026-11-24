import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Crosshair,
  DoorOpen,
  EyeOff,
  GitBranch,
  HelpCircle,
  Layers,
  LayoutGrid,
  Lock,
  MapPin,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import type {
  CompassDirection,
  LocationContainer,
  LocationEdge,
  LocationNode,
} from "../../types";
import { resolveMapIconComponent } from "./mapIcons";
import type { MapContextMenuState } from "./MapDialogs";
import type { PaletteItemKind } from "./MapPaletteBar";
import {
  CONTAINER_CARD_H,
  CONTAINER_CARD_RX,
  CONTAINER_CARD_W,
  CONTAINER_HOVER_PAD,
  DEFAULT_MAP_VIEWBOX_H,
  DEFAULT_MAP_VIEWBOX_W,
  DOUBLE_TAP_MAX_DIST_PX,
  DOUBLE_TAP_MAX_MS,
  GHOST_CARD_H,
  GHOST_CARD_RX,
  GHOST_CARD_W,
  HUB_RADIUS,
  LOCATION_HOVER_RADIUS,
  LOCATION_PORT_RADIUS,
  LOCATION_TILE_HALF,
  LOCATION_TILE_RX,
  LOCATION_TILE_SIZE,
  MAX_MAP_ZOOM,
  MIN_MAP_ZOOM,
  PORT_HIT_RADIUS,
  PORT_TOUCH_HIT_RADIUS,
  TAP_MOVE_THRESHOLD_PX,
  clampZoom,
  computeDistanceBadgeWidth,
  computeDoubleTapZoomPan,
  computeEdgeClippedSegment,
  computePanDeltaWorld,
  computePinchZoomPan,
  computeResponsiveViewBox,
  computeSvgClientScale,
  getContainerPortPoint,
  resolveCanvasCursor,
  shouldDeferNodeDragToTapFirst,
  type MapViewBox,
  type NodeShapeDescriptor,
} from "./mapGeometry";
import {
  COMPASS_ANGLES,
  COMPASS_ORDER,
  DEFAULT_FALLBACK_DISTANCE_METERS,
  canonicalEdgePairKey,
  clientToWorldPoint,
  formatBundleTravelDuration,
  formatDistanceCompact,
  formatExitTravelPhrase,
  formatTravelDuration,
  getAdaptiveDistanceStep,
  parseCommittedEdgeDistance,
  resolveBidirectionalProjectedBundle,
  resolvePortConnectionPreview,
  sanitizeEdgeDistanceInput,
  stepEdgeDistanceDraft,
  worldPointToWrapperPoint,
  type LinkDragState,
  type NodeDragState,
  type PortReassignDragState,
  type ProjectedDepthTopology,
  type SelectedEdgeState,
} from "./topologyProjection";

export interface SpatialTopologyCanvasProps {
  svgRef: React.RefObject<SVGSVGElement>;
  canvasWrapRef?: React.RefObject<HTMLDivElement>;
  viewportGroupRef: React.RefObject<SVGGElement>;
  panDragRef: React.MutableRefObject<{
    active: boolean;
    moved: boolean;
    button: number;
    startClientX: number;
    startClientY: number;
    origPanX: number;
    origPanY: number;
  }>;
  mode: "campaign" | "editor";
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  pan: { x: number; y: number };
  setPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  nodeDrag: NodeDragState | null;
  setNodeDrag: React.Dispatch<React.SetStateAction<NodeDragState | null>>;
  linkDrag: LinkDragState | null;
  setLinkDrag: React.Dispatch<React.SetStateAction<LinkDragState | null>>;
  portReassignDrag?: PortReassignDragState | null;
  setPortReassignDrag?: React.Dispatch<
    React.SetStateAction<PortReassignDragState | null>
  >;
  hoveredNodeKey: string | null;
  setHoveredNodeKey: React.Dispatch<React.SetStateAction<string | null>>;
  projectedTopology: ProjectedDepthTopology;
  workingEdges?: LocationEdge[];
  locationMap?: Map<string, LocationNode>;
  fullMapCoords: Record<string, { x: number; y: number }>;
  ghostCoords?: Record<string, { x: number; y: number }>;
  selectedContainer: LocationContainer | null;
  selectedLocation: LocationNode | null;
  selectedGhostLocId?: string | null;
  activeLoc: LocationNode | undefined;
  activeNeighborIds: Set<string>;
  unreachableSet: Set<string>;
  occupiedSlotsByLocId: Map<string, Set<CompassDirection>>;
  isMutatingLocked: boolean;
  inlineEdgeEdit: { edgeId: string; midX: number; midY: number; value: string } | null;
  setInlineEdgeEdit: React.Dispatch<
    React.SetStateAction<{ edgeId: string; midX: number; midY: number; value: string } | null>
  >;
  statusNotice: string | null;
  setStatusNotice: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedLocId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedContainerId: React.Dispatch<React.SetStateAction<string | null>>;
  setSelectedGhostLocId?: React.Dispatch<React.SetStateAction<string | null>>;
  selectedEdgeState?: SelectedEdgeState | null;
  onSelectEdgePair?: (edgeId: string) => void;
  onSelectEdgeBundle?: (edgeIds: string[]) => void;
  onClearEdgeSelection?: () => void;
  setContextMenu: React.Dispatch<React.SetStateAction<MapContextMenuState | null>>;
  openContextMenuAt: (e: React.MouseEvent, target: MapContextMenuState["target"]) => void;
  handleUpdateEdgeDistance: (edgeId: string, distanceMeters: number) => void;
  handleDeleteEdge: (edgeId: string) => void;
  handleDeleteEdgeGroup: (edgeIds: string[]) => void;
  onReassignEdgeSlot?: (edgeId: string, nextSlot: CompassDirection) => boolean | void;
  drillIntoContainer: (contId: string | null) => void;
  onJumpToContainer?: (containerId: string | null, focusLocId?: string) => void;
  handleCenter?: () => void;
  isMobileViewport?: boolean;
  undoCount?: number;
  onUndo?: () => void;
  validationMessage?: string | null;
  unreachableCount?: number;
  onFocusInvalid?: () => void;
  canAddContainerHere?: boolean;
  onQuickAdd?: (kind: PaletteItemKind) => void;
  isAutoLayoutPreviewing?: boolean;
  onApplyAutoLayout?: () => void;
  onResetAutoLayout?: () => void;
}

export const SpatialTopologyCanvas: React.FC<SpatialTopologyCanvasProps> = ({
  svgRef,
  canvasWrapRef,
  viewportGroupRef,
  panDragRef,
  mode,
  zoom,
  setZoom,
  pan,
  setPan,
  nodeDrag,
  setNodeDrag,
  linkDrag,
  setLinkDrag,
  portReassignDrag = null,
  setPortReassignDrag,
  hoveredNodeKey,
  setHoveredNodeKey,
  projectedTopology,
  workingEdges = [],
  locationMap,
  fullMapCoords,
  ghostCoords = {},
  selectedContainer,
  selectedLocation,
  selectedGhostLocId = null,
  activeLoc,
  activeNeighborIds,
  unreachableSet,
  occupiedSlotsByLocId,
  isMutatingLocked,
  inlineEdgeEdit,
  setInlineEdgeEdit,
  statusNotice,
  setStatusNotice,
  setSelectedLocId,
  setSelectedContainerId,
  setSelectedGhostLocId,
  selectedEdgeState = null,
  onSelectEdgePair,
  onSelectEdgeBundle,
  onClearEdgeSelection,
  setContextMenu,
  openContextMenuAt,
  handleUpdateEdgeDistance,
  handleDeleteEdge,
  handleDeleteEdgeGroup,
  onReassignEdgeSlot,
  drillIntoContainer,
  onJumpToContainer,
  handleCenter,
  isMobileViewport = false,
  undoCount = 0,
  onUndo,
  validationMessage = null,
  unreachableCount = 0,
  onFocusInvalid,
  canAddContainerHere = true,
  onQuickAdd,
  isAutoLayoutPreviewing = false,
  onApplyAutoLayout,
  onResetAutoLayout,
}) => {
  const [isPanning, setIsPanning] = useState(false);
  const [isPinching, setIsPinching] = useState(false);
  const [showMobileLegend, setShowMobileLegend] = useState(false);
  const [showMobileAddMenu, setShowMobileAddMenu] = useState(false);
  const [hoveredEdgePairKey, setHoveredEdgePairKey] = useState<string | null>(null);
  const [hoveredPort, setHoveredPort] = useState<{
    locationId: string;
    slot: CompassDirection;
  } | null>(null);
  const [armedTouchPort, setArmedTouchPort] = useState<{
    locationId: string;
    edgeId: string;
    slot: CompassDirection;
  } | null>(null);
  const [previewTimePairKeys, setPreviewTimePairKeys] = useState<Set<string>>(
    () => new Set()
  );

  useEffect(() => {
    if (!armedTouchPort) return;
    if (isMutatingLocked || selectedLocation?.id !== armedTouchPort.locationId) {
      setArmedTouchPort(null);
    }
  }, [armedTouchPort, isMutatingLocked, selectedLocation?.id]);

  const effectiveLocationMap = useMemo(() => {
    if (locationMap) return locationMap;
    const map = new Map<string, LocationNode>();
    for (const loc of projectedTopology.visibleLocations) {
      map.set(loc.id, loc);
    }
    for (const ghost of projectedTopology.ghostExternalNodes) {
      map.set(ghost.destination.id, ghost.destination);
    }
    return map;
  }, [
    locationMap,
    projectedTopology.visibleLocations,
    projectedTopology.ghostExternalNodes,
  ]);

  const outgoingEdgeByLocSlot = useMemo(() => {
    const map = new Map<string, LocationEdge>();
    for (const edge of workingEdges) {
      if (!edge.compass_direction) continue;
      const key = `${edge.from_location_id}:${edge.compass_direction}`;
      if (!map.has(key)) {
        map.set(key, edge);
      }
    }
    return map;
  }, [workingEdges]);

  const activePortPreview = useMemo(() => {
    const target = portReassignDrag
      ? {
          locationId: portReassignDrag.locationId,
          slot: portReassignDrag.fromSlot,
        }
      : armedTouchPort
      ? {
          locationId: armedTouchPort.locationId,
          slot: armedTouchPort.slot,
        }
      : hoveredPort;
    if (!target) return null;
    return resolvePortConnectionPreview({
      locationId: target.locationId,
      slot: target.slot,
      edges: workingEdges,
      projectedTopology,
      locationMap: effectiveLocationMap,
    });
  }, [
    portReassignDrag,
    armedTouchPort,
    hoveredPort,
    workingEdges,
    projectedTopology,
    effectiveLocationMap,
  ]);
  const lastTouchEdgePreviewAtRef = useRef<number>(0);
  const toggleBadgeTimePreview = useCallback((pairKey: string) => {
    setPreviewTimePairKeys((prev) => {
      const next = new Set(prev);
      if (next.has(pairKey)) {
        next.delete(pairKey);
      } else {
        next.add(pairKey);
      }
      return next;
    });
  }, []);
  const [viewBox, setViewBox] = useState<MapViewBox>(() => ({
    x: -DEFAULT_MAP_VIEWBOX_W / 2,
    y: -DEFAULT_MAP_VIEWBOX_H / 2,
    width: DEFAULT_MAP_VIEWBOX_W,
    height: DEFAULT_MAP_VIEWBOX_H,
  }));
  const edgeHoverTimeoutRef = useRef<number | null>(null);
  const inlineInputRef = useRef<HTMLInputElement | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;
  const viewBoxRef = useRef(viewBox);
  viewBoxRef.current = viewBox;

  const panPointerIdRef = useRef<number | null>(null);
  const panPointerTypeRef = useRef<string>("mouse");
  const pendingTapTargetRef = useRef<
    | { kind: "location" | "container" | "ghost"; id: string }
    | { kind: "edge-select"; select: () => void }
    | { kind: "edge-preview"; pairKey: string }
    | null
  >(null);
  const activeTouchPointersRef = useRef<Map<number, { clientX: number; clientY: number }>>(
    new Map()
  );
  const pinchStateRef = useRef<{
    initialZoom: number;
    initialDist: number;
    anchorWorld: { x: number; y: number };
  } | null>(null);
  const lastEmptyTapRef = useRef<{ time: number; clientX: number; clientY: number } | null>(
    null
  );

  // Aspect-adaptive viewBox via ResizeObserver so portrait phones render crisp, tappable nodes
  useEffect(() => {
    const el = canvasWrapRef?.current ?? svgRef.current?.parentElement ?? null;
    if (!el || typeof ResizeObserver === "undefined") return;
    const updateFromRect = (w: number, h: number) => {
      const next = computeResponsiveViewBox(w, h);
      setViewBox((prev) =>
        prev.width === next.width && prev.height === next.height ? prev : next
      );
    };
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      updateFromRect(rect.width, rect.height);
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      updateFromRect(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [canvasWrapRef, svgRef]);

  const cancelEdgeHoverClear = () => {
    if (edgeHoverTimeoutRef.current !== null) {
      window.clearTimeout(edgeHoverTimeoutRef.current);
      edgeHoverTimeoutRef.current = null;
    }
  };

  const enterEdgeHover = (pairKey: string) => {
    cancelEdgeHoverClear();
    setHoveredEdgePairKey(pairKey);
  };

  const leaveEdgeHover = (pairKey: string) => {
    cancelEdgeHoverClear();
    edgeHoverTimeoutRef.current = window.setTimeout(() => {
      setHoveredEdgePairKey((curr) => (curr === pairKey ? null : curr));
    }, 90);
  };

  useEffect(() => {
    return () => {
      cancelEdgeHoverClear();
    };
  }, []);

  useEffect(() => {
    if (!inlineEdgeEdit?.edgeId) return;
    const input = inlineInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [inlineEdgeEdit?.edgeId]);

  // Always clean up active touch pointers even after pinch/pan transitions to idle
  useEffect(() => {
    if (typeof window === "undefined") return;
    const removeTouchPointer = (e: PointerEvent) => {
      if (e.pointerType === "touch") {
        activeTouchPointersRef.current.delete(e.pointerId);
      }
    };
    const clearAllTouchPointers = () => {
      activeTouchPointersRef.current.clear();
    };
    window.addEventListener("pointerup", removeTouchPointer);
    window.addEventListener("pointercancel", removeTouchPointer);
    window.addEventListener("blur", clearAllTouchPointers);
    return () => {
      window.removeEventListener("pointerup", removeTouchPointer);
      window.removeEventListener("pointercancel", removeTouchPointer);
      window.removeEventListener("blur", clearAllTouchPointers);
    };
  }, []);

  // Unified pointer-event panning + two-finger pinch-to-zoom + tap/double-tap resolution
  useEffect(() => {
    if (!isPanning && !isPinching) return;

    const handleWindowPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch" && activeTouchPointersRef.current.has(e.pointerId)) {
        activeTouchPointersRef.current.set(e.pointerId, {
          clientX: e.clientX,
          clientY: e.clientY,
        });
      }

      if (pinchStateRef.current && activeTouchPointersRef.current.size >= 2) {
        const pts = Array.from(activeTouchPointersRef.current.values());
        const p1 = pts[0];
        const p2 = pts[1];
        const svgRect = svgRef.current?.getBoundingClientRect();
        if (p1 && p2 && svgRect && svgRect.width > 0 && svgRect.height > 0) {
          const currentDist = Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY);
          const midClient = {
            x: (p1.clientX + p2.clientX) / 2,
            y: (p1.clientY + p2.clientY) / 2,
          };
          const next = computePinchZoomPan({
            initialZoom: pinchStateRef.current.initialZoom,
            initialDist: pinchStateRef.current.initialDist,
            currentDist,
            anchorWorld: pinchStateRef.current.anchorWorld,
            midClient,
            svgRect,
            viewBox: viewBoxRef.current,
          });
          setZoom(next.zoom);
          setPan(next.pan);
        }
        return;
      }

      if (!panDragRef.current.active) return;
      if (
        panPointerIdRef.current !== null &&
        e.pointerId !== panPointerIdRef.current
      ) {
        return;
      }

      const rawDx = e.clientX - panDragRef.current.startClientX;
      const rawDy = e.clientY - panDragRef.current.startClientY;
      if (Math.hypot(rawDx, rawDy) > TAP_MOVE_THRESHOLD_PX) {
        panDragRef.current.moved = true;
        pendingTapTargetRef.current = null;
      }
      const svgRect = svgRef.current?.getBoundingClientRect();
      const svgScale = computeSvgClientScale(svgRect, viewBoxRef.current);
      const { dx, dy } = computePanDeltaWorld(
        rawDx,
        rawDy,
        svgScale,
        zoomRef.current || 1
      );
      setPan({
        x: panDragRef.current.origPanX + dx,
        y: panDragRef.current.origPanY + dy,
      });
    };

    const finishGesture = (e?: PointerEvent, cancelled = false) => {
      if (e && e.pointerType === "touch") {
        activeTouchPointersRef.current.delete(e.pointerId);
      } else if (!e) {
        activeTouchPointersRef.current.clear();
      }

      if (pinchStateRef.current) {
        if (activeTouchPointersRef.current.size < 2) {
          pinchStateRef.current = null;
          setIsPinching(false);
          panDragRef.current.active = false;
          panPointerIdRef.current = null;
          pendingTapTargetRef.current = null;
          setIsPanning(false);
        }
        return;
      }

      if (
        e &&
        panPointerIdRef.current !== null &&
        e.pointerId !== panPointerIdRef.current
      ) {
        return;
      }

      const pendingTap = pendingTapTargetRef.current;
      pendingTapTargetRef.current = null;

      if (
        !cancelled &&
        e &&
        panDragRef.current.active &&
        !panDragRef.current.moved &&
        panDragRef.current.button === 0 &&
        (e.button === 0 || e.pointerType === "touch")
      ) {
        if (pendingTap) {
          lastEmptyTapRef.current = null;
          setShowMobileLegend(false);
          setShowMobileAddMenu(false);
          if (pendingTap.kind === "location") {
            setSelectedContainerId(null);
            setSelectedGhostLocId?.(null);
            setSelectedLocId(pendingTap.id);
          } else if (pendingTap.kind === "container") {
            setSelectedGhostLocId?.(null);
            setSelectedLocId(null);
            setSelectedContainerId(pendingTap.id);
          } else if (pendingTap.kind === "ghost") {
            setSelectedContainerId(null);
            setSelectedLocId(null);
            setSelectedGhostLocId?.(pendingTap.id);
          } else if (pendingTap.kind === "edge-select") {
            pendingTap.select();
          } else if (pendingTap.kind === "edge-preview") {
            lastTouchEdgePreviewAtRef.current = Date.now();
            toggleBadgeTimePreview(pendingTap.pairKey);
          }
        } else {
          // Empty canvas tap: check touch double-tap focal zoom, else deselect
          const now = Date.now();
          const prevTap = lastEmptyTapRef.current;
          const isDoubleTap =
            e.pointerType === "touch" &&
            prevTap !== null &&
            now - prevTap.time <= DOUBLE_TAP_MAX_MS &&
            Math.hypot(e.clientX - prevTap.clientX, e.clientY - prevTap.clientY) <=
              DOUBLE_TAP_MAX_DIST_PX;

          if (isDoubleTap) {
            lastEmptyTapRef.current = null;
            const svgRect = svgRef.current?.getBoundingClientRect();
            if (svgRect && svgRect.width > 0 && svgRect.height > 0) {
              const tappedWorld = clientToWorldPoint(
                e.clientX,
                e.clientY,
                svgRef.current,
                viewportGroupRef.current,
                panRef.current,
                zoomRef.current || 1,
                viewBoxRef.current
              );
              const next = computeDoubleTapZoomPan({
                currentZoom: zoomRef.current || 1,
                tappedWorld,
                tapClient: { x: e.clientX, y: e.clientY },
                svgRect,
                viewBox: viewBoxRef.current,
              });
              setZoom(next.zoom);
              setPan(next.pan);
            }
          } else {
            if (e.pointerType === "touch") {
              lastEmptyTapRef.current = {
                time: now,
                clientX: e.clientX,
                clientY: e.clientY,
              };
            }
            setSelectedLocId(null);
            setSelectedContainerId(null);
            setSelectedGhostLocId?.(null);
            onClearEdgeSelection?.();
            setContextMenu(null);
            setInlineEdgeEdit(null);
            setArmedTouchPort(null);
            setShowMobileLegend(false);
            setShowMobileAddMenu(false);
          }
        }
      }

      panDragRef.current.active = false;
      panPointerIdRef.current = null;
      setIsPanning(false);
    };

    const handleWindowPointerUp = (e: PointerEvent) => finishGesture(e, false);
    const handleWindowPointerCancel = (e: PointerEvent) => finishGesture(e, true);
    const handleWindowBlur = () => finishGesture(undefined, true);

    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerCancel);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerCancel);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [
    isPanning,
    isPinching,
    panDragRef,
    svgRef,
    viewportGroupRef,
    setPan,
    setZoom,
    setSelectedLocId,
    setSelectedContainerId,
    setSelectedGhostLocId,
    onClearEdgeSelection,
    setContextMenu,
    setInlineEdgeEdit,
  ]);

  const shapeByNodeId = useMemo(() => {
    const map = new Map<string, NodeShapeDescriptor>();
    for (const sn of projectedTopology.visibleSupernodes) {
      map.set(sn.container.id, { kind: "container" });
    }
    for (const loc of projectedTopology.visibleLocations) {
      map.set(loc.id, { kind: loc.is_hub ? "hub" : "location" });
    }
    return map;
  }, [projectedTopology.visibleSupernodes, projectedTopology.visibleLocations]);

  const selectedBundleEdgeIds = useMemo(
    () =>
      selectedEdgeState?.kind === "bundle"
        ? new Set(selectedEdgeState.edgeIds)
        : null,
    [selectedEdgeState]
  );

  const selectedPairEndpointKey = useMemo(() => {
    if (selectedEdgeState?.kind !== "pair") return null;
    for (const pe of projectedTopology.projectedEdges) {
      if (
        pe.rawEdge.id === selectedEdgeState.edgeId ||
        pe.groupedEdges?.some((ge) => ge.id === selectedEdgeState.edgeId)
      ) {
        return canonicalEdgePairKey(
          pe.rawEdge.from_location_id,
          pe.rawEdge.to_location_id
        );
      }
    }
    for (const ge of projectedTopology.ghostEdges) {
      if (ge.rawEdge.id === selectedEdgeState.edgeId) {
        return canonicalEdgePairKey(
          ge.rawEdge.from_location_id,
          ge.rawEdge.to_location_id
        );
      }
    }
    return null;
  }, [
    selectedEdgeState,
    projectedTopology.projectedEdges,
    projectedTopology.ghostEdges,
  ]);

  const renderedEdges = useMemo(() => {
    const focusedId = selectedContainer?.id || selectedLocation?.id;

    const buildEdgeRenderItem = (params: {
      edge: Pick<
        LocationEdge,
        | "id"
        | "distance_meters"
        | "speed_modifier"
        | "travel_mode"
        | "obstacles"
        | "is_blocked"
        | "is_secret"
        | "direction_label"
      > & {
        sourceNodeId: string;
        targetNodeId: string;
        isAggregated: boolean;
        isUndiscoveredSecret: boolean;
        containsBlockedEdge: boolean;
        containsUndiscoveredSecretEdge: boolean;
        containsObstacles: boolean;
        rawEdge: LocationEdge;
        groupedEdges?: LocationEdge[];
        passagePairCount?: number;
        maxDistanceMeters?: number;
      };
      p1: { x: number; y: number } | undefined;
      p2: { x: number; y: number } | undefined;
      shape1: NodeShapeDescriptor;
      shape2: NodeShapeDescriptor;
      isDirect: boolean;
      showLabel: boolean;
      pairKey: string;
      isGhost: boolean;
    }) => {
      const { edge, p1, p2, shape1, shape2, isDirect, showLabel, pairKey, isGhost } =
        params;
      if (!p1 || !p2) return null;
      const clipped = computeEdgeClippedSegment(p1, shape1, p2, shape2);
      const passagePairCount =
        edge.passagePairCount ?? (edge.groupedEdges?.length ?? 0);
      const aggSuffix =
        edge.isAggregated && passagePairCount > 1 ? ` · ${passagePairCount}` : "";
      const blockedCue = edge.containsBlockedEdge;
      const secretCue = edge.containsUndiscoveredSecretEdge;
      const iconCount = (blockedCue ? 1 : 0) + (secretCue ? 1 : 0);
      const extraIconW = iconCount > 0 ? iconCount * 10 + 2 : 0;

      const distanceLabelText = `${formatDistanceCompact(edge.distance_meters)}${aggSuffix}`;
      const timeDurationText =
        edge.isAggregated &&
        edge.groupedEdges &&
        edge.groupedEdges.length > 1 &&
        passagePairCount > 1
          ? formatBundleTravelDuration(edge.groupedEdges)
          : formatTravelDuration(edge.distance_meters, edge.speed_modifier);
      const timeLabelText = `${timeDurationText}${aggSuffix}`;
      const isTimePreview = previewTimePairKeys.has(pairKey);
      const labelText = isTimePreview ? timeLabelText : distanceLabelText;
      const badgeWidth = computeDistanceBadgeWidth(labelText) + extraIconW;
      const hitWidth = Math.max(
        badgeWidth,
        computeDistanceBadgeWidth(
          isTimePreview ? distanceLabelText : timeLabelText
        ) + extraIconW
      );

      const isSelected = (() => {
        if (!selectedEdgeState) return false;
        if (selectedEdgeState.kind === "bundle" && selectedBundleEdgeIds) {
          return (
            selectedBundleEdgeIds.has(edge.rawEdge.id) ||
            Boolean(edge.groupedEdges?.some((ge) => selectedBundleEdgeIds.has(ge.id)))
          );
        }
        if (selectedEdgeState.kind === "pair") {
          if (
            edge.rawEdge.id === selectedEdgeState.edgeId ||
            edge.groupedEdges?.some((ge) => ge.id === selectedEdgeState.edgeId)
          ) {
            return true;
          }
          if (
            !edge.isAggregated &&
            selectedPairEndpointKey &&
            canonicalEdgePairKey(
              edge.rawEdge.from_location_id,
              edge.rawEdge.to_location_id
            ) === selectedPairEndpointKey
          ) {
            return true;
          }
        }
        return false;
      })();

      const singleTravelPhrase = formatExitTravelPhrase(
        edge.distance_meters,
        edge.speed_modifier,
        edge.travel_mode
      );
      const statusCues: string[] = [];
      if (blockedCue) statusCues.push("Blocked");
      if (secretCue) statusCues.push("Secret · Hidden");
      else if (edge.is_secret) statusCues.push("Secret · Discovered");
      if (edge.containsObstacles && !edge.isAggregated && edge.obstacles.length > 0) {
        statusCues.push(`Obstacles: ${edge.obstacles.join(", ")}`);
      }
      const statusPart = statusCues.length > 0 ? ` · ${statusCues.join(" · ")}` : "";
      const speedPart =
        !edge.isAggregated && Math.abs((edge.speed_modifier ?? 1) - 1) > 0.01
          ? ` (${edge.speed_modifier}×)`
          : "";
      const hoverTitle =
        edge.isAggregated && edge.groupedEdges && edge.groupedEdges.length > 1
          ? `${
              passagePairCount > 1 ? `${passagePairCount} boundary passages (` : "("
            }${formatDistanceCompact(edge.distance_meters)} · ${timeDurationText}${statusPart}): ${edge.groupedEdges
              .map((ge) => ge.direction_label)
              .join(" · ")} — click to inspect`
          : `${edge.direction_label} (${formatDistanceCompact(edge.distance_meters)} · ${singleTravelPhrase}${speedPart}${statusPart}) — click to inspect`;

      return {
        edge,
        clipped,
        isDirect,
        isSelected,
        blockedCue,
        secretCue,
        extraIconW,
        showLabel,
        labelText,
        isTimePreview,
        hoverTitle,
        passagePairCount,
        badgeWidth,
        hitWidth,
        pairKey,
        isGhost,
      };
    };

    const normalItems = projectedTopology.projectedEdges.map((edge) => {
      const isDirect =
        edge.sourceNodeId === activeLoc?.id ||
        edge.targetNodeId === activeLoc?.id ||
        edge.sourceNodeId === focusedId ||
        edge.targetNodeId === focusedId;
      const showLabel =
        edge.sourceNodeId <= edge.targetNodeId ||
        !projectedTopology.projectedEdges.some(
          (o) =>
            o.sourceNodeId === edge.targetNodeId &&
            o.targetNodeId === edge.sourceNodeId
        );
      const bundle = edge.isAggregated
        ? resolveBidirectionalProjectedBundle(
            edge,
            projectedTopology.projectedEdges
          )
        : null;
      const effectiveEdge = bundle
        ? {
            ...edge,
            distance_meters: bundle.minDistanceMeters,
            maxDistanceMeters: bundle.maxDistanceMeters,
            containsBlockedEdge: bundle.containsBlockedEdge,
            containsUndiscoveredSecretEdge: bundle.containsUndiscoveredSecretEdge,
            containsObstacles: bundle.containsObstacles,
            groupedEdges: bundle.allEdges,
            passagePairCount: bundle.passagePairCount,
          }
        : edge;
      return buildEdgeRenderItem({
        edge: effectiveEdge,
        p1: fullMapCoords[edge.sourceNodeId],
        p2: fullMapCoords[edge.targetNodeId],
        shape1: shapeByNodeId.get(edge.sourceNodeId) ?? { kind: "location" },
        shape2: shapeByNodeId.get(edge.targetNodeId) ?? { kind: "location" },
        isDirect,
        showLabel,
        pairKey: [edge.sourceNodeId, edge.targetNodeId].sort().join("<->"),
        isGhost: false,
      });
    });

    const ghostItems = projectedTopology.ghostEdges.map((ge) => {
      const isOutgoing = ge.sourceNodeId === ge.portalLocationId;
      const p1 = isOutgoing
        ? fullMapCoords[ge.sourceNodeId]
        : ghostCoords[ge.externalLocationId];
      const p2 = isOutgoing
        ? ghostCoords[ge.externalLocationId]
        : fullMapCoords[ge.targetNodeId];
      const shape1: NodeShapeDescriptor = isOutgoing
        ? shapeByNodeId.get(ge.sourceNodeId) ?? { kind: "location" }
        : { kind: "ghost" };
      const shape2: NodeShapeDescriptor = isOutgoing
        ? { kind: "ghost" }
        : shapeByNodeId.get(ge.targetNodeId) ?? { kind: "location" };
      const showLabel =
        ge.sourceNodeId <= ge.targetNodeId ||
        !projectedTopology.ghostEdges.some(
          (o) =>
            o.sourceNodeId === ge.targetNodeId &&
            o.targetNodeId === ge.sourceNodeId
        );
      const isDirect =
        ge.portalLocationId === activeLoc?.id ||
        ge.portalLocationId === focusedId ||
        ge.externalLocationId === selectedGhostLocId;

      return buildEdgeRenderItem({
        edge: {
          ...ge,
          isAggregated: false,
          containsBlockedEdge: ge.is_blocked,
          containsUndiscoveredSecretEdge: ge.isUndiscoveredSecret,
          containsObstacles: (ge.obstacles?.length ?? 0) > 0,
        },
        p1,
        p2,
        shape1,
        shape2,
        isDirect,
        showLabel,
        pairKey: `ghost:${[ge.portalLocationId, ge.externalLocationId].sort().join("<->")}`,
        isGhost: true,
      });
    });

    return [...normalItems, ...ghostItems].filter(
      (item): item is NonNullable<typeof item> => item !== null
    );
  }, [
    projectedTopology.projectedEdges,
    projectedTopology.ghostEdges,
    fullMapCoords,
    ghostCoords,
    shapeByNodeId,
    activeLoc?.id,
    selectedContainer?.id,
    selectedLocation?.id,
    selectedGhostLocId,
    selectedEdgeState,
    selectedBundleEdgeIds,
    selectedPairEndpointKey,
    previewTimePairKeys,
  ]);

  const activeInlineEdge = useMemo(() => {
    if (!inlineEdgeEdit) return null;
    const match = renderedEdges.find(
      (re) =>
        re.edge.rawEdge.id === inlineEdgeEdit.edgeId ||
        re.edge.groupedEdges?.some((ge) => ge.id === inlineEdgeEdit.edgeId)
    );
    return {
      ...inlineEdgeEdit,
      midX: match ? match.clipped.midX : inlineEdgeEdit.midX,
      midY: match ? match.clipped.midY : inlineEdgeEdit.midY,
      fallbackMeters: match
        ? match.edge.distance_meters
        : DEFAULT_FALLBACK_DISTANCE_METERS,
      speedModifier: match?.edge.speed_modifier ?? 1,
      pairKey: match?.pairKey ?? null,
    };
  }, [inlineEdgeEdit, renderedEdges]);

  const selectRenderedEdge = (
    edge: (typeof renderedEdges)[number]["edge"],
    passagePairCount: number
  ) => {
    if (
      edge.isAggregated &&
      edge.groupedEdges &&
      edge.groupedEdges.length > 1 &&
      passagePairCount > 1
    ) {
      onSelectEdgeBundle?.(edge.groupedEdges.map((ge) => ge.id));
    } else {
      onSelectEdgePair?.(edge.rawEdge.id);
    }
  };

  const openEdgeEditor = (
    ev: React.MouseEvent,
    edge: (typeof renderedEdges)[number]["edge"],
    clipped: (typeof renderedEdges)[number]["clipped"],
    passagePairCount: number,
    pairKey?: string
  ) => {
    ev.stopPropagation();
    if (pairKey) {
      setPreviewTimePairKeys((prev) => {
        if (!prev.has(pairKey)) return prev;
        const next = new Set(prev);
        next.delete(pairKey);
        return next;
      });
    }
    if (
      edge.isAggregated &&
      edge.groupedEdges &&
      edge.groupedEdges.length > 1 &&
      passagePairCount > 1
    ) {
      onSelectEdgeBundle?.(edge.groupedEdges.map((ge) => ge.id));
    } else if (!isMutatingLocked) {
      setInlineEdgeEdit({
        edgeId: edge.rawEdge.id,
        midX: clipped.midX,
        midY: clipped.midY,
        value: String(edge.distance_meters),
      });
    }
  };

  const isEditorQuickDeleteEnabled =
    mode === "editor" &&
    !isMutatingLocked &&
    !inlineEdgeEdit &&
    !nodeDrag &&
    !linkDrag &&
    !isPanning;

  const commitInlineEdgeEdit = () => {
    if (!activeInlineEdge) return;
    const committed = parseCommittedEdgeDistance(activeInlineEdge.value);
    if (committed !== null) {
      handleUpdateEdgeDistance(activeInlineEdge.edgeId, committed);
    }
    setInlineEdgeEdit(null);
  };

  const stepInlineEdgeEdit = (direction: 1 | -1, fine = false) => {
    if (!activeInlineEdge) return;
    setInlineEdgeEdit((prev) =>
      prev
        ? {
            ...prev,
            value: stepEdgeDistanceDraft(
              prev.value,
              direction,
              activeInlineEdge.fallbackMeters,
              fine
            ),
          }
        : null
    );
  };

  const wrapEl = canvasWrapRef?.current ?? svgRef.current?.parentElement ?? null;
  const inlineOverlayPoint = activeInlineEdge
    ? worldPointToWrapperPoint(
        activeInlineEdge.midX,
        activeInlineEdge.midY,
        svgRef.current,
        wrapEl,
        viewportGroupRef.current,
        pan,
        zoom,
        viewBox
      )
    : null;
  const wrapRectForClamp = wrapEl?.getBoundingClientRect();
  const clampedOverlayPos =
    inlineOverlayPoint && wrapRectForClamp && wrapRectForClamp.width > 180
      ? {
          left: Math.max(86, Math.min(wrapRectForClamp.width - 86, inlineOverlayPoint.x)),
          top: Math.max(20, Math.min(wrapRectForClamp.height - 20, inlineOverlayPoint.y)),
        }
      : inlineOverlayPoint
      ? { left: inlineOverlayPoint.x, top: inlineOverlayPoint.y }
      : null;

  const parsedInlineMeters = activeInlineEdge
    ? parseCommittedEdgeDistance(activeInlineEdge.value)
    : null;
  const activeInlinePreviewMeters =
    parsedInlineMeters ??
    activeInlineEdge?.fallbackMeters ??
    DEFAULT_FALLBACK_DISTANCE_METERS;
  const inlineDecStep = getAdaptiveDistanceStep(
    Math.max(1, activeInlinePreviewMeters - 1)
  );
  const inlineIncStep = getAdaptiveDistanceStep(activeInlinePreviewMeters);

  const canvasCursor = resolveCanvasCursor({
    isNodeDragging: Boolean(nodeDrag?.hasMoved || portReassignDrag?.hasMoved),
    isLinking: Boolean(linkDrag),
    isPanning,
  });

  const portHitCircleRadius = isMobileViewport
    ? PORT_TOUCH_HIT_RADIUS
    : PORT_HIT_RADIUS;

  const handleSvgContextMenu = (
    e: React.MouseEvent,
    target?: MapContextMenuState["target"]
  ) => {
    if (isMobileViewport || panPointerTypeRef.current === "touch") {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (target) {
      openContextMenuAt(e, target);
    } else {
      e.preventDefault();
      setContextMenu(null);
    }
  };

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    panPointerTypeRef.current = e.pointerType;

    if (e.pointerType === "touch") {
      if (e.isPrimary) {
        activeTouchPointersRef.current.clear();
        pinchStateRef.current = null;
      }
      activeTouchPointersRef.current.set(e.pointerId, {
        clientX: e.clientX,
        clientY: e.clientY,
      });

      if (activeTouchPointersRef.current.size >= 2) {
        // Engage two-finger midpoint pinch-to-zoom; cancel any active single-finger gesture
        setNodeDrag(null);
        setLinkDrag(null);
        setPortReassignDrag?.(null);
        setArmedTouchPort(null);
        panDragRef.current.active = false;
        panPointerIdRef.current = null;
        pendingTapTargetRef.current = null;
        lastEmptyTapRef.current = null;
        setIsPanning(false);

        const pts = Array.from(activeTouchPointersRef.current.values());
        const p1 = pts[0];
        const p2 = pts[1];
        if (p1 && p2) {
          const initialDist = Math.hypot(
            p2.clientX - p1.clientX,
            p2.clientY - p1.clientY
          );
          const midX = (p1.clientX + p2.clientX) / 2;
          const midY = (p1.clientY + p2.clientY) / 2;
          const anchorWorld = clientToWorldPoint(
            midX,
            midY,
            svgRef.current,
            viewportGroupRef.current,
            panRef.current,
            zoomRef.current || 1,
            viewBoxRef.current
          );
          pinchStateRef.current = {
            initialZoom: zoomRef.current || 1,
            initialDist: Math.max(1, initialDist),
            anchorWorld,
          };
          setIsPinching(true);
        }
        return;
      }
    }

    if ((e.button !== 0 && e.button !== 1) || nodeDrag || linkDrag || portReassignDrag) return;
    if (e.button === 1) {
      e.preventDefault();
    }
    panPointerIdRef.current = e.pointerId;
    panDragRef.current = {
      active: true,
      moved: false,
      button: e.button,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origPanX: pan.x,
      origPanY: pan.y,
    };
    setIsPanning(true);
  };

  return (
    <>
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
            style={{
              width: "100%",
              height: "100%",
              minHeight: 0,
              cursor: canvasCursor,
              display: "block",
              touchAction: "none",
              userSelect: "none",
              WebkitUserSelect: "none",
              WebkitTouchCallout: "none",
            }}
            onWheel={(e) => {
              e.preventDefault();
              const delta = e.deltaY < 0 ? 0.15 : -0.15;
              setZoom((z) => clampZoom(z + delta));
            }}
            onPointerDown={handleSvgPointerDown}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
              }
            }}
            onContextMenu={(e) => handleSvgContextMenu(e)}
          >
            <g
              ref={viewportGroupRef}
              transform={`scale(${zoom}) translate(${pan.x}, ${pan.y})`}
            >
              {/* Layer 1: Edge Lines & Active Link Rubber-Band */}
              <g data-layer="edge-lines">
                {renderedEdges.map(
                  ({
                    edge,
                    clipped,
                    isDirect,
                    isSelected,
                    blockedCue,
                    secretCue,
                    hoverTitle,
                    passagePairCount,
                    pairKey,
                    isGhost,
                  }) => {
                  const isPortPreviewed = Boolean(
                    activePortPreview?.edgePairKey &&
                      activePortPreview.edgePairKey === pairKey
                  );
                  const lineStroke = isPortPreviewed
                    ? "#fbbf24"
                    : isSelected
                    ? "#22d3ee"
                    : secretCue
                    ? "#a78bfa"
                    : isGhost
                    ? isDirect
                      ? "#22d3ee"
                      : "#64748b"
                    : blockedCue
                    ? "#fb7185"
                    : isDirect
                    ? "#06b6d4"
                    : edge.isAggregated
                    ? "#475569"
                    : "#334155";
                  const lineDash = secretCue
                    ? "6 4"
                    : isGhost
                    ? "5 4"
                    : blockedCue
                    ? "4 3"
                    : edge.isAggregated
                    ? "2 2"
                    : undefined;
                  const lineOpacity = isPortPreviewed || isSelected
                    ? 1
                    : secretCue
                    ? 0.85
                    : isGhost
                    ? isDirect
                      ? 0.85
                      : 0.6
                    : blockedCue
                    ? 0.9
                    : 1;
                  const lineWidth = isPortPreviewed
                    ? edge.isAggregated
                      ? 3.8
                      : 3.4
                    : isSelected
                    ? edge.isAggregated
                      ? 3.2
                      : 2.8
                    : edge.isAggregated
                    ? isDirect
                      ? 2.8
                      : 2.0
                    : isDirect
                    ? 2.4
                    : 1.5;
                  return (
                    <g
                      key={edge.id}
                      data-edge-selected={isSelected ? "true" : undefined}
                      data-port-preview-edge={isPortPreviewed ? "true" : undefined}
                      onMouseEnter={() => {
                        if (isEditorQuickDeleteEnabled) enterEdgeHover(pairKey);
                      }}
                      onMouseLeave={() => leaveEdgeHover(pairKey)}
                      onPointerDown={(ev) => {
                        if (ev.button !== 0) return;
                        if (ev.pointerType === "touch" || isMobileViewport) {
                          pendingTapTargetRef.current = {
                            kind: "edge-select",
                            select: () =>
                              selectRenderedEdge(edge, passagePairCount),
                          };
                        } else {
                          ev.stopPropagation();
                        }
                      }}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        if (isPanning) return;
                        selectRenderedEdge(edge, passagePairCount);
                      }}
                      onContextMenu={(ev) =>
                        handleSvgContextMenu(ev, {
                          kind: "edge",
                          edgeId: edge.rawEdge.id,
                          ...(edge.isAggregated && edge.groupedEdges?.length
                            ? {
                                groupedEdgeIds: edge.groupedEdges.map((ge) => ge.id),
                                pairCount: passagePairCount,
                              }
                            : {}),
                        })
                      }
                      onDoubleClick={(ev) =>
                        openEdgeEditor(ev, edge, clipped, passagePairCount, pairKey)
                      }
                    >
                      <title>{hoverTitle}</title>
                      {/* Invisible wide hit-target so thin lines hover & click cleanly */}
                      <line
                        x1={clipped.x1}
                        y1={clipped.y1}
                        x2={clipped.x2}
                        y2={clipped.y2}
                        stroke="transparent"
                        strokeWidth={14}
                        style={{ cursor: isPanning ? "grabbing" : "pointer" }}
                      />
                      <line
                        x1={clipped.x1}
                        y1={clipped.y1}
                        x2={clipped.x2}
                        y2={clipped.y2}
                        stroke={lineStroke}
                        strokeOpacity={lineOpacity}
                        strokeWidth={lineWidth}
                        strokeDasharray={lineDash}
                        pointerEvents="none"
                      />
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

                {/* Port Reassignment Guide Line (same-node slot move) */}
                {portReassignDrag?.hasMoved && (() => {
                  const locPt = fullMapCoords[portReassignDrag.locationId];
                  let endX = portReassignDrag.currX;
                  let endY = portReassignDrag.currY;
                  if (locPt && portReassignDrag.hoverSlot && !portReassignDrag.hoverSlotBlocked) {
                    const a = COMPASS_ANGLES[portReassignDrag.hoverSlot];
                    endX = locPt.x + Math.cos(a) * LOCATION_PORT_RADIUS;
                    endY = locPt.y + Math.sin(a) * LOCATION_PORT_RADIUS;
                  }
                  return (
                    <line
                      x1={portReassignDrag.startX}
                      y1={portReassignDrag.startY}
                      x2={endX}
                      y2={endY}
                      stroke={
                        portReassignDrag.hoverSlotBlocked
                          ? "#f43f5e"
                          : portReassignDrag.hoverSlot &&
                            portReassignDrag.hoverSlot !== portReassignDrag.fromSlot
                          ? "#10b981"
                          : "#fbbf24"
                      }
                      strokeWidth={2}
                      strokeDasharray="3 2"
                      pointerEvents="none"
                    />
                  );
                })()}
              </g>

              {/* Layer 2: Opaque Distance Badges (painted above all edge lines) */}
              <g data-layer="edge-badges">
                {renderedEdges.map(
                  ({
                    edge,
                    clipped,
                    isDirect,
                    isSelected,
                    blockedCue,
                    secretCue,
                    extraIconW,
                    showLabel,
                    labelText,
                    isTimePreview,
                    hoverTitle,
                    passagePairCount,
                    badgeWidth,
                    hitWidth,
                    pairKey,
                  }) => {
                    if (!showLabel) return null;
                    if (
                      activeInlineEdge &&
                      (activeInlineEdge.pairKey === pairKey ||
                        inlineEdgeEdit?.edgeId === edge.rawEdge.id)
                    ) {
                      return null;
                    }
                    const isPortPreviewed = Boolean(
                      activePortPreview?.edgePairKey &&
                        activePortPreview.edgePairKey === pairKey
                    );
                    const badgeStroke = isPortPreviewed
                      ? "#fbbf24"
                      : isSelected
                      ? "#22d3ee"
                      : isTimePreview
                      ? "#f59e0b"
                      : secretCue
                      ? "#a78bfa"
                      : blockedCue
                      ? "#fb7185"
                      : isDirect
                      ? "#0891b2"
                      : "#334155";
                    const iconStartX = clipped.midX - badgeWidth / 2 + 4;
                    return (
                      <g
                        key={`badge-${edge.id}`}
                        data-badge-mode={isTimePreview ? "time" : "distance"}
                        style={{ cursor: isPanning ? "grabbing" : "pointer" }}
                        onPointerDown={(ev) => {
                          if (ev.button !== 0) return;
                          if (ev.pointerType === "touch" || isMobileViewport) {
                            pendingTapTargetRef.current = {
                              kind: "edge-select",
                              select: () =>
                                selectRenderedEdge(edge, passagePairCount),
                            };
                          } else {
                            ev.stopPropagation();
                          }
                        }}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          if (
                            isPanning ||
                            Date.now() - lastTouchEdgePreviewAtRef.current < 400
                          ) {
                            return;
                          }
                          if (ev.shiftKey) {
                            toggleBadgeTimePreview(pairKey);
                          } else {
                            selectRenderedEdge(edge, passagePairCount);
                          }
                        }}
                        onMouseEnter={() => {
                          if (isEditorQuickDeleteEnabled) enterEdgeHover(pairKey);
                        }}
                        onMouseLeave={() => leaveEdgeHover(pairKey)}
                        onContextMenu={(ev) =>
                          handleSvgContextMenu(ev, {
                            kind: "edge",
                            edgeId: edge.rawEdge.id,
                            ...(edge.isAggregated && edge.groupedEdges?.length
                              ? {
                                  groupedEdgeIds: edge.groupedEdges.map((ge) => ge.id),
                                  pairCount: passagePairCount,
                                }
                              : {}),
                          })
                        }
                        onDoubleClick={(ev) =>
                          openEdgeEditor(ev, edge, clipped, passagePairCount, pairKey)
                        }
                      >
                        <title>{hoverTitle}</title>
                        <rect
                          x={clipped.midX - hitWidth / 2}
                          y={clipped.midY - 9}
                          width={hitWidth}
                          height={16}
                          fill="transparent"
                        />
                        <rect
                          x={clipped.midX - badgeWidth / 2}
                          y={clipped.midY - 9}
                          width={badgeWidth}
                          height={16}
                          rx={4}
                          fill="#0b0e14"
                          fillOpacity={1}
                          stroke={badgeStroke}
                          strokeWidth={isSelected ? 1.4 : 1}
                        />
                        {secretCue && (
                          <EyeOff
                            size={8.5}
                            x={iconStartX}
                            y={clipped.midY - 5.25}
                            color="#c084fc"
                          />
                        )}
                        {blockedCue && (
                          <Lock
                            size={8.5}
                            x={secretCue ? iconStartX + 10 : iconStartX}
                            y={clipped.midY - 5.25}
                            color="#fb7185"
                          />
                        )}
                        <text
                          x={clipped.midX + extraIconW / 2}
                          y={clipped.midY + 2}
                          textAnchor="middle"
                          fill={
                            isTimePreview
                              ? "#fde68a"
                              : secretCue
                              ? "#ddd6fe"
                              : isSelected || isDirect
                              ? "#67e8f9"
                              : "#94a3b8"
                          }
                          fontSize="8.2"
                          fontWeight="600"
                        >
                          {labelText}
                        </text>
                      </g>
                    );
                  }
                )}
              </g>

              {/* Layer 3: Child Container Supernodes (Levels 1-4) & Level 0 Locations */}
              <g data-layer="nodes">
              {projectedTopology.visibleSupernodes.map((sn) => {
                const pt = fullMapCoords[sn.container.id];
                if (!pt) return null;
                const isSelected = selectedContainer?.id === sn.container.id;
                const isDropHover =
                  nodeDrag?.hoverTarget?.kind === "container" &&
                  nodeDrag.hoverTarget.id === sn.container.id;
                const isPortPreviewTarget =
                  activePortPreview?.targetKind === "container" &&
                  activePortPreview.targetNodeId === sn.container.id;
                const dropStroke = isDropHover
                  ? nodeDrag!.hoverTarget!.valid
                    ? "#10b981"
                    : "#f43f5e"
                  : isPortPreviewTarget
                  ? "#fbbf24"
                  : sn.hasActivePlayer
                  ? "#f59e0b"
                  : isSelected
                  ? "#22d3ee"
                  : "#475569";

                const cardW = CONTAINER_CARD_W;
                const cardH = CONTAINER_CARD_H;
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
                    data-port-preview-target={isPortPreviewTarget ? "container" : undefined}
                    onMouseEnter={() => setHoveredNodeKey(`cont:${sn.container.id}`)}
                    onMouseLeave={() =>
                      setHoveredNodeKey((curr) =>
                        curr === `cont:${sn.container.id}` ? null : curr
                      )
                    }
                  >
                    {/* Transparent hover buffer covering card + port ring without triggering node drag */}
                    <rect
                      x={pt.x - cardW / 2 - CONTAINER_HOVER_PAD}
                      y={pt.y - cardH / 2 - CONTAINER_HOVER_PAD}
                      width={cardW + CONTAINER_HOVER_PAD * 2}
                      height={cardH + CONTAINER_HOVER_PAD * 2}
                      rx={CONTAINER_CARD_RX + 4}
                      fill="transparent"
                    />

                    {/* Interactive container card body */}
                    <g
                      style={{ cursor: isPanning ? "grabbing" : "pointer" }}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        if (
                          shouldDeferNodeDragToTapFirst({
                            pointerType: e.pointerType,
                            isSelected,
                            isMutatingLocked,
                          })
                        ) {
                          pendingTapTargetRef.current = {
                            kind: "container",
                            id: sn.container.id,
                          };
                          return;
                        }
                        e.stopPropagation();
                        const wpt = clientToWorldPoint(
                          e.clientX,
                          e.clientY,
                          svgRef.current,
                          viewportGroupRef.current,
                          pan,
                          zoom,
                          viewBox
                        );
                        setNodeDrag({
                          kind: "container",
                          id: sn.container.id,
                          pointerId: e.pointerId,
                          pointerType: e.pointerType,
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
                        handleSvgContextMenu(e, {
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
                        rx={CONTAINER_CARD_RX}
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
                        rx={CONTAINER_CARD_RX}
                        fill="#0b0e14"
                      />
                      <rect
                        x={pt.x - cardW / 2}
                        y={pt.y - cardH / 2}
                        width={cardW}
                        height={cardH}
                        rx={CONTAINER_CARD_RX}
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
                        {sn.descendantLocationCount} locations ·{" "}
                        {sn.externalPortalsCount} portals
                      </text>
                    </g>

                    {/* Compass link ports on container perimeter */}
                    {showPorts &&
                      !isMutatingLocked &&
                      COMPASS_ORDER.map((slot) => {
                        const { x: px, y: py } = getContainerPortPoint(
                          pt,
                          COMPASS_ANGLES[slot]
                        );
                        const isTargetHovered =
                          linkDrag?.hoverTarget?.kind === "container" &&
                          linkDrag.hoverTarget.id === sn.container.id &&
                          linkDrag.hoverTarget.slot === slot;
                        return (
                          <g
                            key={slot}
                            data-link-port={`${sn.container.id}:${slot}`}
                            style={{ cursor: "crosshair" }}
                            onPointerDown={(ev) => {
                              ev.stopPropagation();
                              setLinkDrag({
                                sourceKind: "container",
                                sourceId: sn.container.id,
                                sourceSlot: slot,
                                pointerId: ev.pointerId,
                                pointerType: ev.pointerType,
                                startX: px,
                                startY: py,
                                currX: px,
                                currY: py,
                                hoverTarget: null,
                              });
                            }}
                          >
                            <circle cx={px} cy={py} r={portHitCircleRadius} fill="transparent" />
                            <circle
                              cx={px}
                              cy={py}
                              r={isTargetHovered ? 5.2 : 3.8}
                              fill={isTargetHovered ? "#22d3ee" : "#0f172a"}
                              stroke={isTargetHovered ? "#a5f3fc" : "#22d3ee"}
                              strokeWidth={1.3}
                              pointerEvents="none"
                            />
                          </g>
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
                const isPortPreviewTarget =
                  activePortPreview?.targetKind === "location" &&
                  activePortPreview.targetNodeId === loc.id;
                const previewTargetSlot = isPortPreviewTarget
                  ? activePortPreview.targetSlot
                  : null;

                const IconComp = resolveMapIconComponent(
                  loc.icon,
                  loc.is_hub ? "hub" : "location"
                );

                const borderColor = isDropHover
                  ? nodeDrag!.hoverTarget!.valid
                    ? "#10b981"
                    : "#f43f5e"
                  : isPortPreviewTarget
                  ? "#fbbf24"
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
                const isReassignSourceHere =
                  (portReassignDrag?.locationId === loc.id &&
                    portReassignDrag.hasMoved) ||
                  armedTouchPort?.locationId === loc.id;
                const showPorts =
                  hoveredNodeKey === `loc:${loc.id}` ||
                  isSelected ||
                  Boolean(linkDrag) ||
                  hoveredPort?.locationId === loc.id ||
                  portReassignDrag?.locationId === loc.id ||
                  armedTouchPort?.locationId === loc.id;

                const extExits =
                  projectedTopology.externalPortalsByLocationId[loc.id] ?? [];

                // Regular octagon points for Passage Hub
                const hubPoints = Array.from({ length: 8 }, (_, k) => {
                  const angle = (k * Math.PI) / 4 + Math.PI / 8;
                  return `${(pt.x + Math.cos(angle) * HUB_RADIUS).toFixed(1)},${(
                    pt.y +
                    Math.sin(angle) * HUB_RADIUS
                  ).toFixed(1)}`;
                }).join(" ");

                return (
                  <g
                    key={loc.id}
                    data-node-kind="location"
                    data-node-id={loc.id}
                    data-port-preview-target={isPortPreviewTarget ? "location" : undefined}
                    style={{
                      opacity:
                        mode === "campaign" && !loc.is_visited && !isSelected
                          ? 0.85
                          : 1,
                    }}
                    onMouseEnter={() => setHoveredNodeKey(`loc:${loc.id}`)}
                    onMouseLeave={() => {
                      setHoveredNodeKey((curr) =>
                        curr === `loc:${loc.id}` ? null : curr
                      );
                      setHoveredPort((curr) =>
                        curr?.locationId === loc.id ? null : curr
                      );
                    }}
                  >
                    {/* Transparent hover buffer bridging gap to compass ports without triggering node drag */}
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={LOCATION_HOVER_RADIUS}
                      fill="transparent"
                    />

                    {/* Interactive location body */}
                    <g
                      style={{ cursor: isPanning ? "grabbing" : "pointer" }}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        if (
                          shouldDeferNodeDragToTapFirst({
                            pointerType: e.pointerType,
                            isSelected,
                            isMutatingLocked,
                          })
                        ) {
                          pendingTapTargetRef.current = {
                            kind: "location",
                            id: loc.id,
                          };
                          return;
                        }
                        e.stopPropagation();
                        const wpt = clientToWorldPoint(
                          e.clientX,
                          e.clientY,
                          svgRef.current,
                          viewportGroupRef.current,
                          pan,
                          zoom,
                          viewBox
                        );
                        setNodeDrag({
                          kind: "location",
                          id: loc.id,
                          pointerId: e.pointerId,
                          pointerType: e.pointerType,
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
                        handleSvgContextMenu(e, { kind: "location", id: loc.id })
                      }
                    >
                      {/* Selection, Unreachable, or Opposite-Port Preview Ring */}
                      {(isSelected || isUnreachable || isPortPreviewTarget) && (
                        <circle
                          cx={pt.x}
                          cy={pt.y}
                          r={loc.is_hub ? 22 : 24}
                          fill="none"
                          stroke={
                            isPortPreviewTarget
                              ? "#fbbf24"
                              : isUnreachable
                              ? "#f59e0b"
                              : "#38bdf8"
                          }
                          strokeWidth={isPortPreviewTarget ? 2.4 : 1.8}
                          strokeDasharray={isPortPreviewTarget ? undefined : "3 3"}
                          pointerEvents="none"
                        />
                      )}

                      {/* Node Body: Opaque backing + Octagon Passage Hub OR Rounded Tile Location */}
                      {loc.is_hub ? (
                        <>
                          <polygon points={hubPoints} fill="#0b0e14" />
                          <polygon
                            points={hubPoints}
                            fill={fillColor}
                            stroke={borderColor}
                            strokeWidth={2}
                          />
                        </>
                      ) : (
                        <>
                          <rect
                            x={pt.x - LOCATION_TILE_HALF}
                            y={pt.y - LOCATION_TILE_HALF}
                            width={LOCATION_TILE_SIZE}
                            height={LOCATION_TILE_SIZE}
                            rx={LOCATION_TILE_RX}
                            fill="#0b0e14"
                          />
                          <rect
                            x={pt.x - LOCATION_TILE_HALF}
                            y={pt.y - LOCATION_TILE_HALF}
                            width={LOCATION_TILE_SIZE}
                            height={LOCATION_TILE_SIZE}
                            rx={LOCATION_TILE_RX}
                            fill={fillColor}
                            stroke={borderColor}
                            strokeWidth={isAnchorOrStart || isSelected ? 2.2 : 1.7}
                          />
                        </>
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

                      {/* Name Label with opaque stroke halo */}
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
                        stroke="#0b0e14"
                        strokeWidth={3}
                        strokeLinejoin="round"
                        paintOrder="stroke"
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
                          stroke="#0b0e14"
                          strokeWidth={3}
                          strokeLinejoin="round"
                          paintOrder="stroke"
                          fontSize="8"
                        >
                          ↗ {extExits[0].destination.name}
                          {extExits.length > 1 ? ` +${extExits.length - 1}` : ""}
                        </text>
                      )}
                    </g>

                    {/* Opposite-end reciprocal port highlight when destination node's ports aren't open */}
                    {previewTargetSlot && !showPorts && (() => {
                      const a = COMPASS_ANGLES[previewTargetSlot];
                      const px = pt.x + Math.cos(a) * LOCATION_PORT_RADIUS;
                      const py = pt.y + Math.sin(a) * LOCATION_PORT_RADIUS;
                      return (
                        <g
                          data-port-preview-target-slot={`${loc.id}:${previewTargetSlot}`}
                          pointerEvents="none"
                        >
                          <circle
                            cx={px}
                            cy={py}
                            r={8}
                            fill="rgba(251, 191, 36, 0.28)"
                            stroke="#fbbf24"
                            strokeWidth={1.4}
                          />
                          <circle
                            cx={px}
                            cy={py}
                            r={4.8}
                            fill="#fbbf24"
                            stroke="#fef3c7"
                            strokeWidth={1.4}
                          />
                        </g>
                      );
                    })()}

                    {/* 8 Compass Connection Link Ports */}
                    {showPorts &&
                      !isMutatingLocked &&
                      COMPASS_ORDER.map((slot) => {
                        const a = COMPASS_ANGLES[slot];
                        const px = pt.x + Math.cos(a) * LOCATION_PORT_RADIUS;
                        const py = pt.y + Math.sin(a) * LOCATION_PORT_RADIUS;
                        const outgoingEdge = outgoingEdgeByLocSlot.get(
                          `${loc.id}:${slot}`
                        );
                        const isOccupied = occupiedSet.has(slot);
                        const isTargetHovered =
                          linkDrag?.hoverTarget?.kind === "location" &&
                          linkDrag.hoverTarget.id === loc.id &&
                          linkDrag.hoverTarget.slot === slot;
                        const isReassignOrigin =
                          (portReassignDrag?.locationId === loc.id &&
                            portReassignDrag.fromSlot === slot) ||
                          (armedTouchPort?.locationId === loc.id &&
                            armedTouchPort.slot === slot);
                        const isReassignHoverEmpty =
                          portReassignDrag?.locationId === loc.id &&
                          portReassignDrag.hasMoved &&
                          portReassignDrag.hoverSlot === slot &&
                          !portReassignDrag.hoverSlotBlocked &&
                          slot !== portReassignDrag.fromSlot;
                        const isReassignHoverBlocked =
                          portReassignDrag?.locationId === loc.id &&
                          portReassignDrag.hasMoved &&
                          portReassignDrag.hoverSlot === slot &&
                          portReassignDrag.hoverSlotBlocked;
                        const isReassignCandidateEmpty =
                          isReassignSourceHere && !isOccupied;
                        const isOppositePreviewSlot =
                          previewTargetSlot === slot;
                        const isSelfHoveredOccupied =
                          isOccupied &&
                          hoveredPort?.locationId === loc.id &&
                          hoveredPort.slot === slot;

                        const portTooltip = isOccupied && outgoingEdge
                          ? (() => {
                              const destName =
                                effectiveLocationMap.get(outgoingEdge.to_location_id)
                                  ?.name ?? outgoingEdge.to_location_id;
                              const isPreviewMatch =
                                activePortPreview?.fromLocationId === loc.id &&
                                activePortPreview.fromSlot === slot;
                              const summary = isPreviewMatch
                                ? activePortPreview.tooltipText
                                : `${slot} → ${destName}`;
                              return isMobileViewport
                                ? `${summary} — tap to move or inspect`
                                : `${summary} — drag to empty port to move, click to inspect`;
                            })()
                          : isReassignCandidateEmpty
                          ? `${slot} — empty port (release or tap to move link here)`
                          : `${slot} — drag to create a link`;

                        const portCursor = isReassignHoverBlocked
                          ? "not-allowed"
                          : isOccupied
                          ? portReassignDrag?.locationId === loc.id
                            ? "grabbing"
                            : "grab"
                          : isReassignCandidateEmpty
                          ? "pointer"
                          : "crosshair";

                        const dotRadius =
                          isOppositePreviewSlot || isReassignHoverEmpty
                            ? 5.4
                            : isTargetHovered ||
                              isReassignOrigin ||
                              isSelfHoveredOccupied
                            ? 5.0
                            : isReassignCandidateEmpty
                            ? 4.2
                            : isOccupied
                            ? 4
                            : 3.4;

                        const dotFill = isReassignHoverBlocked
                          ? "#f43f5e"
                          : isReassignHoverEmpty
                          ? "#10b981"
                          : isOppositePreviewSlot ||
                            isReassignOrigin ||
                            isSelfHoveredOccupied
                          ? "#fbbf24"
                          : isTargetHovered
                          ? "#22d3ee"
                          : isOccupied
                          ? "#06b6d4"
                          : "#0f172a";

                        const dotStroke = isReassignHoverBlocked
                          ? "#fecdd3"
                          : isReassignHoverEmpty
                          ? "#a7f3d0"
                          : isOppositePreviewSlot ||
                            isReassignOrigin ||
                            isSelfHoveredOccupied
                          ? "#fef3c7"
                          : isReassignCandidateEmpty
                          ? "#22d3ee"
                          : isOccupied
                          ? "#a5f3fc"
                          : "#38bdf8";

                        return (
                          <g
                            key={slot}
                            data-link-port={`${loc.id}:${slot}`}
                            data-port-occupied={isOccupied ? "true" : undefined}
                            data-port-preview-target-slot={
                              isOppositePreviewSlot
                                ? `${loc.id}:${slot}`
                                : undefined
                            }
                            style={{ cursor: portCursor }}
                            onMouseEnter={() => {
                              if (isOccupied) {
                                setHoveredPort({ locationId: loc.id, slot });
                              }
                            }}
                            onMouseLeave={() => {
                              setHoveredPort((curr) =>
                                curr?.locationId === loc.id && curr.slot === slot
                                  ? null
                                  : curr
                              );
                            }}
                            onPointerDown={(ev) => {
                              ev.stopPropagation();
                              const isTouch =
                                ev.pointerType === "touch" || isMobileViewport;

                              // Mobile two-tap: if a port on this node is armed, tapping any empty port moves it there
                              if (
                                armedTouchPort &&
                                armedTouchPort.locationId === loc.id
                              ) {
                                if (!isOccupied) {
                                  onReassignEdgeSlot?.(
                                    armedTouchPort.edgeId,
                                    slot
                                  );
                                  setArmedTouchPort(null);
                                  return;
                                }
                                if (armedTouchPort.slot === slot) {
                                  const edgeIdToInspect = armedTouchPort.edgeId;
                                  setArmedTouchPort(null);
                                  onSelectEdgePair?.(edgeIdToInspect);
                                  return;
                                }
                                if (outgoingEdge) {
                                  setArmedTouchPort({
                                    locationId: loc.id,
                                    edgeId: outgoingEdge.id,
                                    slot,
                                  });
                                  return;
                                }
                              }

                              if (isOccupied && outgoingEdge) {
                                if (isTouch) {
                                  setArmedTouchPort({
                                    locationId: loc.id,
                                    edgeId: outgoingEdge.id,
                                    slot,
                                  });
                                  return;
                                }
                                if (setPortReassignDrag) {
                                  setPortReassignDrag({
                                    locationId: loc.id,
                                    edgeId: outgoingEdge.id,
                                    fromSlot: slot,
                                    pointerId: ev.pointerId,
                                    pointerType: ev.pointerType,
                                    startClientX: ev.clientX,
                                    startClientY: ev.clientY,
                                    startX: px,
                                    startY: py,
                                    currX: px,
                                    currY: py,
                                    hasMoved: false,
                                    hoverSlot: slot,
                                    hoverSlotBlocked: false,
                                  });
                                  return;
                                }
                              }

                              setArmedTouchPort(null);
                              setLinkDrag({
                                sourceKind: "location",
                                sourceId: loc.id,
                                sourceSlot: slot,
                                pointerId: ev.pointerId,
                                pointerType: ev.pointerType,
                                startX: px,
                                startY: py,
                                currX: px,
                                currY: py,
                                hoverTarget: null,
                              });
                            }}
                          >
                            <title>{portTooltip}</title>
                            <circle
                              cx={px}
                              cy={py}
                              r={portHitCircleRadius}
                              fill="transparent"
                            />
                            {(isOppositePreviewSlot || isReassignOrigin) && (
                              <circle
                                cx={px}
                                cy={py}
                                r={8}
                                fill="rgba(251, 191, 36, 0.24)"
                                stroke="#fbbf24"
                                strokeWidth={1.2}
                                pointerEvents="none"
                              />
                            )}
                            {isReassignCandidateEmpty && !isReassignHoverEmpty && (
                              <circle
                                cx={px}
                                cy={py}
                                r={6.8}
                                fill="rgba(34, 211, 238, 0.14)"
                                stroke="#22d3ee"
                                strokeWidth={1}
                                strokeDasharray="2 2"
                                pointerEvents="none"
                              />
                            )}
                            <circle
                              cx={px}
                              cy={py}
                              r={dotRadius}
                              fill={dotFill}
                              stroke={dotStroke}
                              strokeWidth={1.3}
                              pointerEvents="none"
                            />
                          </g>
                        );
                      })}
                  </g>
                );
              })}

              {/* Shared External Ghost Nodes (Cross-Boundary Portal Destinations) */}
              {projectedTopology.ghostExternalNodes.map((ghost) => {
                const pt = ghostCoords[ghost.destination.id];
                if (!pt) return null;
                const isSelected = selectedGhostLocId === ghost.destination.id;
                const isPortPreviewTarget =
                  activePortPreview?.targetKind === "ghost" &&
                  activePortPreview.targetNodeId === ghost.destination.id;
                const GhostIcon = resolveMapIconComponent(
                  ghost.destination.icon,
                  ghost.destination.is_hub ? "hub" : "location"
                );
                const truncatedName =
                  ghost.destination.name.length > 16
                    ? `${ghost.destination.name.slice(0, 15)}…`
                    : ghost.destination.name;
                const truncatedCont =
                  ghost.destinationContainerName.length > 18
                    ? `${ghost.destinationContainerName.slice(0, 17)}…`
                    : ghost.destinationContainerName;

                return (
                  <g
                    key={`ghost-node-${ghost.destination.id}`}
                    data-node-kind="ghost"
                    data-node-id={ghost.destination.id}
                    data-port-preview-target={isPortPreviewTarget ? "ghost" : undefined}
                    style={{
                      opacity: isPortPreviewTarget ? 1 : isSelected ? 0.94 : 0.72,
                      cursor: isPanning ? "grabbing" : "pointer",
                    }}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      if (
                        shouldDeferNodeDragToTapFirst({
                          pointerType: e.pointerType,
                          isSelected,
                          isMutatingLocked,
                        })
                      ) {
                        pendingTapTargetRef.current = {
                          kind: "ghost",
                          id: ghost.destination.id,
                        };
                        return;
                      }
                      e.stopPropagation();
                      const wpt = clientToWorldPoint(
                        e.clientX,
                        e.clientY,
                        svgRef.current,
                        viewportGroupRef.current,
                        pan,
                        zoom,
                        viewBox
                      );
                      setNodeDrag({
                        kind: "ghost",
                        id: ghost.destination.id,
                        pointerId: e.pointerId,
                        pointerType: e.pointerType,
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
                      onJumpToContainer?.(
                        ghost.destination.container_id ?? null,
                        ghost.destination.id
                      );
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    <rect
                      x={pt.x - GHOST_CARD_W / 2}
                      y={pt.y - GHOST_CARD_H / 2}
                      width={GHOST_CARD_W}
                      height={GHOST_CARD_H}
                      rx={GHOST_CARD_RX}
                      fill="#0b0e14"
                      fillOpacity={0.82}
                      stroke={
                        isPortPreviewTarget
                          ? "#fbbf24"
                          : isSelected
                          ? "#22d3ee"
                          : "#475569"
                      }
                      strokeWidth={isPortPreviewTarget ? 2.2 : isSelected ? 1.8 : 1.2}
                      strokeDasharray={isPortPreviewTarget ? undefined : "4 3"}
                    />
                    <GhostIcon
                      size={13}
                      x={pt.x - GHOST_CARD_W / 2 + 9}
                      y={pt.y - 7}
                      color={isSelected ? "#67e8f9" : "#94a3b8"}
                    />
                    <text
                      x={pt.x - GHOST_CARD_W / 2 + 27}
                      y={pt.y - 3}
                      fill={isSelected ? "#e2e8f0" : "#cbd5e1"}
                      fontSize="9.5"
                      fontWeight="600"
                    >
                      {truncatedName}
                    </text>
                    <text
                      x={pt.x - GHOST_CARD_W / 2 + 27}
                      y={pt.y + 10}
                      fill="#67e8f9"
                      fillOpacity={0.85}
                      fontSize="7.6"
                    >
                      ↗ {truncatedCont}
                    </text>
                  </g>
                );
              })}
              </g>

              {/* Layer 4: World-Editor Hover Quick-Delete Link Control */}
              {isEditorQuickDeleteEnabled && hoveredEdgePairKey && (
                <g data-layer="edge-quick-delete">
                  {renderedEdges.map(
                    ({
                      edge,
                      clipped,
                      showLabel,
                      passagePairCount,
                      badgeWidth,
                      pairKey,
                    }) => {
                    if (!showLabel || hoveredEdgePairKey !== pairKey) return null;
                    // Anchor compact circled X on the top-right corner of the distance badge
                    const qx = clipped.midX + badgeWidth / 2 - 1;
                    const qy = clipped.midY - 9;
                    const deleteTitle =
                      edge.isAggregated && passagePairCount > 1
                        ? `Delete all ${passagePairCount} linked passages`
                        : "Delete link";
                    return (
                      <g
                        key={`quick-del-${pairKey}`}
                        data-edge-quick-delete={edge.id}
                        style={{ cursor: "pointer" }}
                        onMouseEnter={() => enterEdgeHover(pairKey)}
                        onMouseLeave={() => leaveEdgeHover(pairKey)}
                        onMouseDown={(ev) => {
                          ev.preventDefault();
                          ev.stopPropagation();
                        }}
                        onPointerDown={(ev) => {
                          ev.preventDefault();
                          ev.stopPropagation();
                        }}
                        onDoubleClick={(ev) => ev.stopPropagation()}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          cancelEdgeHoverClear();
                          setHoveredEdgePairKey(null);
                          if (edge.isAggregated && edge.groupedEdges?.length) {
                            handleDeleteEdgeGroup(
                              edge.groupedEdges.map((ge) => ge.id)
                            );
                          } else {
                            handleDeleteEdge(edge.rawEdge.id);
                          }
                        }}
                      >
                        <title>{deleteTitle}</title>
                        {/* Invisible hover bridge over top-right corner of badge */}
                        <rect
                          x={clipped.midX + badgeWidth / 2 - 14}
                          y={qy - 9}
                          width={24}
                          height={20}
                          fill="transparent"
                        />
                        <circle cx={qx} cy={qy} r={9} fill="transparent" />
                        <circle
                          cx={qx}
                          cy={qy}
                          r={5.5}
                          fill="#0b0e14"
                          stroke="#f43f5e"
                          strokeWidth={1.3}
                        />
                        <line
                          x1={qx - 2.1}
                          y1={qy - 2.1}
                          x2={qx + 2.1}
                          y2={qy + 2.1}
                          stroke="#fb7185"
                          strokeWidth={1.4}
                          strokeLinecap="round"
                        />
                        <line
                          x1={qx + 2.1}
                          y1={qy - 2.1}
                          x2={qx - 2.1}
                          y2={qy + 2.1}
                          stroke="#fb7185"
                          strokeWidth={1.4}
                          strokeLinecap="round"
                        />
                      </g>
                    );
                  })}
                </g>
              )}
            </g>
          </svg>

          {/* HTML Overlay Inline Link Distance Editor */}
          {activeInlineEdge && (
            <div
              data-layer="inline-edge-editor"
              role="group"
              aria-label="Edit link distance"
              onMouseDown={(ev) => ev.stopPropagation()}
              onPointerDown={(ev) => ev.stopPropagation()}
              onClick={(ev) => ev.stopPropagation()}
              onDoubleClick={(ev) => ev.stopPropagation()}
              onBlur={(ev) => {
                if (ev.currentTarget.contains(ev.relatedTarget as Node | null)) {
                  return;
                }
                commitInlineEdgeEdit();
              }}
              style={{
                position: "absolute",
                left: clampedOverlayPos ? `${clampedOverlayPos.left}px` : "50%",
                top: clampedOverlayPos ? `${clampedOverlayPos.top}px` : "50%",
                transform: "translate(-50%, -50%)",
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
                padding: "2px 4px",
                background: "#0b0e14",
                border: "1px solid #22d3ee",
                borderRadius: 6,
                boxShadow: "0 4px 14px rgba(0, 0, 0, 0.65)",
                zIndex: 25,
              }}
            >
              <button
                type="button"
                className="map-inline-edge-stepper"
                aria-label="Decrease distance"
                title={`Decrease (-${inlineDecStep}m, Shift -1m)`}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                }}
                onPointerDown={(ev) => ev.stopPropagation()}
                onClick={(ev) => {
                  ev.stopPropagation();
                  stepInlineEdgeEdit(-1, ev.shiftKey);
                }}
              >
                −
              </button>
              <input
                ref={inlineInputRef}
                type="text"
                inputMode="decimal"
                className="map-inline-edge-input"
                aria-label="Distance in meters"
                title="Enter meters (e.g. 350) or km (e.g. 1.5km)"
                value={activeInlineEdge.value}
                onChange={(ev) => {
                  const sanitized = sanitizeEdgeDistanceInput(ev.target.value);
                  setInlineEdgeEdit((prev) =>
                    prev ? { ...prev, value: sanitized } : null
                  );
                }}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    commitInlineEdgeEdit();
                  } else if (ev.key === "Escape") {
                    ev.preventDefault();
                    ev.stopPropagation();
                    setInlineEdgeEdit(null);
                  } else if (ev.key === "ArrowUp") {
                    ev.preventDefault();
                    stepInlineEdgeEdit(1, ev.shiftKey);
                  } else if (ev.key === "ArrowDown") {
                    ev.preventDefault();
                    stepInlineEdgeEdit(-1, ev.shiftKey);
                  }
                }}
              />
              <span
                style={{
                  fontSize: "10px",
                  color: "#94a3b8",
                  paddingRight: 2,
                  userSelect: "none",
                }}
              >
                m
              </span>
              <span className="map-inline-edge-walk-hint">
                {formatTravelDuration(
                  activeInlinePreviewMeters,
                  activeInlineEdge.speedModifier
                )}
              </span>
              <button
                type="button"
                className="map-inline-edge-stepper"
                aria-label="Increase distance"
                title={`Increase (+${inlineIncStep}m, Shift +1m)`}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                }}
                onPointerDown={(ev) => ev.stopPropagation()}
                onClick={(ev) => {
                  ev.stopPropagation();
                  stepInlineEdgeEdit(1, ev.shiftKey);
                }}
              >
                +
              </button>
            </div>
          )}

          {/* Mobile two-tap port reassignment banner */}
          {armedTouchPort && activePortPreview && (
            <div
              role="status"
              data-testid="map-touch-port-reassign-bar"
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                position: "absolute",
                top: 10,
                left: "50%",
                transform: "translateX(-50%)",
                maxWidth: "calc(100% - 24px)",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: "rgba(15, 23, 42, 0.95)",
                border: "1px solid #fbbf24",
                color: "#fef3c7",
                padding: "5px 10px",
                borderRadius: 8,
                fontSize: "0.72rem",
                fontWeight: 600,
                boxShadow: "0 4px 14px rgba(0, 0, 0, 0.55)",
                zIndex: 22,
              }}
            >
              <span>
                {activePortPreview.tooltipText} · Tap an empty port to move, or tap{" "}
                {armedTouchPort.slot} again to inspect
              </span>
              <button
                type="button"
                className="btn"
                style={{ padding: "2px 7px", fontSize: "0.68rem" }}
                onClick={() => setArmedTouchPort(null)}
              >
                Cancel
              </button>
            </div>
          )}

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

          {isAutoLayoutPreviewing && onApplyAutoLayout && onResetAutoLayout && (
            <div
              className="map-auto-layout-preview-bar"
              role="region"
              aria-label="Auto-layout preview controls"
              data-testid="map-auto-layout-preview-bar"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span className="map-auto-layout-preview-label">
                <LayoutGrid size={13} aria-hidden="true" />
                <span>Auto-Layout Preview (Current View)</span>
              </span>
              <div className="map-auto-layout-preview-actions">
                <button
                  type="button"
                  className="btn btn-cyan map-auto-layout-preview-btn"
                  onClick={onApplyAutoLayout}
                  data-testid="map-auto-layout-apply-btn"
                >
                  <Check size={13} />
                  <span>Apply</span>
                </button>
                <button
                  type="button"
                  className="btn map-auto-layout-preview-btn"
                  onClick={onResetAutoLayout}
                  data-testid="map-auto-layout-reset-btn"
                >
                  <RotateCcw size={13} />
                  <span>Reset</span>
                </button>
              </div>
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

          {/* Mobile Top-Left Floating Undo & Error-Only Validation Pills */}
          {((undoCount > 0 && !isMutatingLocked && onUndo) ||
            Boolean(validationMessage) ||
            unreachableCount > 0) && (
            <div
              className="map-canvas-tl-mobile"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {undoCount > 0 && !isMutatingLocked && onUndo && (
                <button
                  type="button"
                  className="btn map-mobile-pill-btn map-mobile-pill-btn--amber"
                  onClick={onUndo}
                  title="Undo last map change"
                  aria-label={`Undo (${undoCount})`}
                >
                  <RotateCcw size={13} />
                  <span>Undo ({undoCount})</span>
                </button>
              )}
              {(validationMessage || unreachableCount > 0) && (
                <button
                  type="button"
                  className="btn map-mobile-pill-btn map-mobile-pill-btn--warn"
                  onClick={onFocusInvalid}
                  title={
                    validationMessage ||
                    "Some nodes cannot reach/return from the Starting Location."
                  }
                >
                  <AlertTriangle size={13} />
                  <span>
                    {validationMessage
                      ? validationMessage
                      : `${unreachableCount} Unlinked`}
                  </span>
                </button>
              )}
            </div>
          )}

          {/* Floating Bottom-Left Legend (Desktop) & ? / + Controls (Mobile) */}
          <div
            className="map-canvas-bl-controls"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="map-legend-desktop">
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
              <span className="map-legend-hint">
                Drag nodes · Middle-drag to pan · Drag ports to link · Click link to inspect · Shift+click badge for travel time · Double-click distance to edit
              </span>
            </div>

            {showMobileLegend && (
              <div
                className="map-mobile-legend-popover"
                role="dialog"
                aria-label="Map Legend"
              >
                <div className="map-mobile-legend-header">
                  <span>Map Legend</span>
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "2px 5px" }}
                    aria-label="Close map legend"
                    onClick={() => setShowMobileLegend(false)}
                  >
                    <X size={12} />
                  </button>
                </div>
                <div className="map-mobile-legend-items">
                  <span>
                    <strong style={{ color: "#f59e0b" }}>■</strong>{" "}
                    {mode === "campaign" ? "Current / Start" : "Starting Hub"}
                  </span>
                  <span>
                    <GitBranch size={11} color="#c084fc" /> Passage Hub
                  </span>
                  <span>
                    <DoorOpen size={11} color="#22d3ee" /> Portal
                  </span>
                  <span>
                    <Layers size={11} color="#fbbf24" /> Container
                  </span>
                </div>
                <div className="map-mobile-legend-gestures">
                  Drag to pan · Pinch or double-tap empty map to zoom · Tap node to select · Drag ports to link
                </div>
              </div>
            )}

            {showMobileAddMenu && !isMutatingLocked && onQuickAdd && (
              <div
                className="map-mobile-add-menu"
                role="menu"
                aria-label="Add map element"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="btn map-mobile-add-item"
                  onClick={() => {
                    onQuickAdd("location");
                    setShowMobileAddMenu(false);
                  }}
                >
                  <MapPin size={13} color="#22d3ee" />
                  <span>+ Location</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="btn map-mobile-add-item"
                  onClick={() => {
                    onQuickAdd("hub");
                    setShowMobileAddMenu(false);
                  }}
                >
                  <GitBranch size={13} color="#c084fc" />
                  <span>+ Passage Hub</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="btn map-mobile-add-item"
                  disabled={!canAddContainerHere}
                  title={
                    !canAddContainerHere
                      ? "Level 1 containers cannot hold nested containers"
                      : "Add Container"
                  }
                  onClick={() => {
                    if (!canAddContainerHere) return;
                    onQuickAdd("container");
                    setShowMobileAddMenu(false);
                  }}
                >
                  <Layers size={13} color="#fbbf24" />
                  <span>+ Container</span>
                </button>
              </div>
            )}

            <div className="map-mobile-fab-row">
              <button
                type="button"
                className={`btn map-mobile-fab${showMobileLegend ? " active" : ""}`}
                aria-label="Toggle map legend"
                aria-expanded={showMobileLegend}
                title="Map Legend"
                onClick={() => {
                  setShowMobileAddMenu(false);
                  setShowMobileLegend((v) => !v);
                }}
              >
                <HelpCircle size={16} />
              </button>
              {!isMutatingLocked && onQuickAdd && (
                <button
                  type="button"
                  className={`btn map-mobile-fab map-mobile-fab--accent${showMobileAddMenu ? " active" : ""}`}
                  aria-label="Add map element"
                  aria-expanded={showMobileAddMenu}
                  title="Add Location, Hub, or Container"
                  onClick={() => {
                    setShowMobileLegend(false);
                    setShowMobileAddMenu((v) => !v);
                  }}
                >
                  <Plus size={17} />
                </button>
              )}
            </div>
          </div>

          {/* Floating Bottom-Right Center Icon (All Viewports) + Zoom Indicator Pill (Desktop) */}
          <div
            className="map-canvas-br-controls"
            onPointerDown={(e) => e.stopPropagation()}
          >
            {handleCenter && (
              <button
                type="button"
                className="btn map-canvas-center-btn"
                onClick={handleCenter}
                title="Center on Selected / Active Location"
                aria-label="Center on Selected / Active Location"
              >
                <Crosshair size={16} />
              </button>
            )}

            <div
              data-testid="canvas-zoom-indicator"
              aria-label="Canvas Zoom Indicator"
              className="map-canvas-zoom-pill"
            >
              <button
                type="button"
                disabled={zoom <= MIN_MAP_ZOOM}
                onClick={() => setZoom((z) => clampZoom(z - 0.15))}
                title="Zoom Out"
                aria-label="Canvas Zoom Out"
                style={{
                  background: "transparent",
                  border: "none",
                  color:
                    zoom <= MIN_MAP_ZOOM
                      ? "var(--text-muted)"
                      : "var(--text-secondary)",
                  padding: "4px 7px",
                  cursor: zoom <= MIN_MAP_ZOOM ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                −
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                title="Click to reset zoom to 100%"
                aria-label={`Canvas zoom ${Math.round(zoom * 100)}%`}
                style={{
                  background: "transparent",
                  border: "none",
                  borderLeft: "1px solid var(--border-subtle)",
                  borderRight: "1px solid var(--border-subtle)",
                  color:
                    Math.round(zoom * 100) === 100
                      ? "var(--text-secondary)"
                      : "var(--accent-cyan)",
                  padding: "4px 8px",
                  cursor: "pointer",
                  fontWeight: 700,
                  minWidth: 44,
                }}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                disabled={zoom >= MAX_MAP_ZOOM}
                onClick={() => setZoom((z) => clampZoom(z + 0.15))}
                title="Zoom In"
                aria-label="Canvas Zoom In"
                style={{
                  background: "transparent",
                  border: "none",
                  color:
                    zoom >= MAX_MAP_ZOOM
                      ? "var(--text-muted)"
                      : "var(--text-secondary)",
                  padding: "4px 7px",
                  cursor: zoom >= MAX_MAP_ZOOM ? "not-allowed" : "pointer",
                  fontWeight: 700,
                }}
              >
                +
              </button>
            </div>
          </div>
    </>
  );
};
