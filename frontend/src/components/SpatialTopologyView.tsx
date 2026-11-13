import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
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
import { SpatialTopologyCanvas } from "./map/SpatialTopologyCanvas";
import { TopologyHeaderToolbar } from "./map/TopologyHeaderToolbar";
import { useTopologyMutations } from "./map/useTopologyMutations";
import { useTopologyPointerDrag } from "./map/useTopologyPointerDrag";
import {
  COMPASS_ANGLES,
  COMPASS_ORDER,
  CONTAINER_DEPTH_LABELS,
  OPPOSITE_COMPASS,
  buildContainerBreadcrumbChain,
  clientToWorldPoint,
  cloneGraph,
  computeDynamicPortalIds,
  computeFullMapCoords,
  computePromotionCandidates,
  inferCompassDirection,
  pickCompassSlot,
  projectTopologyForDepth,
  type GraphSnapshot,
  type LinkDragState,
  type NodeDragState,
  type ProjectedContainerSupernode,
  type ProjectedDepthTopology,
  type ProjectedExternalPortalDestination,
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
  computePromotionCandidates,
  inferCompassDirection,
  pickCompassSlot,
  projectTopologyForDepth,
  type ProjectedContainerSupernode,
  type ProjectedDepthTopology,
  type ProjectedExternalPortalDestination,
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

  const {
    patchLocation,
    patchContainer,
    resetCoordinates,
    availableContainerDepthsHere,
    canAddContainerHere,
    createStandaloneAt,
    executeDirectEdgeCreation,
    initiateConnection,
    handleConfirmHubCollision,
    handleConfirmEmptyCanvasCreate,
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
    handleToggleEdgeLocked,
    handleDeleteEdge,
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
    setMultiEdgeModalEdges,
    setPromotionPrompt,
  });

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
      <TopologyHeaderToolbar
        title={title}
        locationsCount={workingLocations.length}
        edgesCount={workingEdges.length}
        containersCount={workingContainers.length}
        zoom={zoom}
        setZoom={setZoom}
        handleCenter={handleCenter}
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
      />

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
          <SpatialTopologyCanvas
            svgRef={svgRef}
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
            selectedContainer={selectedContainer}
            selectedLocation={selectedLocation}
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
            setContextMenu={setContextMenu}
            setMultiEdgeModalEdges={setMultiEdgeModalEdges}
            openContextMenuAt={openContextMenuAt}
            handleUpdateEdgeDistance={handleUpdateEdgeDistance}
            drillIntoContainer={drillIntoContainer}
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

          <PortalPromotionModal
            promotionPrompt={promotionPrompt}
            containerMap={containerMap}
            dynamicPortalIds={projectedTopology.dynamicPortalIds}
            onChangePrompt={setPromotionPrompt}
            onConfirm={executeDirectEdgeCreation}
          />

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
