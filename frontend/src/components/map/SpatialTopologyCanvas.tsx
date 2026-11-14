import React, { useEffect, useMemo, useRef, useState } from "react";
import { DoorOpen, GitBranch, Layers, X } from "lucide-react";
import type {
  CompassDirection,
  LocationContainer,
  LocationEdge,
  LocationNode,
} from "../../types";
import { resolveMapIconComponent } from "./mapIcons";
import type { MapContextMenuState } from "./MapDialogs";
import {
  CONTAINER_CARD_H,
  CONTAINER_CARD_RX,
  CONTAINER_CARD_W,
  CONTAINER_HOVER_PAD,
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
  clampZoom,
  computeDistanceBadgeWidth,
  computeEdgeClippedSegment,
  resolveCanvasCursor,
  type NodeShapeDescriptor,
} from "./mapGeometry";
import {
  COMPASS_ANGLES,
  COMPASS_ORDER,
  clientToWorldPoint,
  parseCommittedEdgeMinutes,
  stepEdgeMinutesDraft,
  worldPointToWrapperPoint,
  type LinkDragState,
  type NodeDragState,
  type ProjectedDepthTopology,
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
  hoveredNodeKey: string | null;
  setHoveredNodeKey: React.Dispatch<React.SetStateAction<string | null>>;
  projectedTopology: ProjectedDepthTopology;
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
  setContextMenu: React.Dispatch<React.SetStateAction<MapContextMenuState | null>>;
  setMultiEdgeModalEdges: React.Dispatch<React.SetStateAction<LocationEdge[] | null>>;
  openContextMenuAt: (e: React.MouseEvent, target: MapContextMenuState["target"]) => void;
  handleUpdateEdgeDistance: (edgeId: string, minutes: number) => void;
  handleDeleteEdge: (edgeId: string) => void;
  handleDeleteEdgeGroup: (edgeIds: string[]) => void;
  drillIntoContainer: (contId: string | null) => void;
  onJumpToContainer?: (containerId: string | null, focusLocId?: string) => void;
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
  hoveredNodeKey,
  setHoveredNodeKey,
  projectedTopology,
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
  setContextMenu,
  setMultiEdgeModalEdges,
  openContextMenuAt,
  handleUpdateEdgeDistance,
  handleDeleteEdge,
  handleDeleteEdgeGroup,
  drillIntoContainer,
  onJumpToContainer,
}) => {
  const [isPanning, setIsPanning] = useState(false);
  const [hoveredEdgePairKey, setHoveredEdgePairKey] = useState<string | null>(null);
  const edgeHoverTimeoutRef = useRef<number | null>(null);
  const inlineInputRef = useRef<HTMLInputElement | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

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

  useEffect(() => {
    if (!isPanning) return;

    const handleWindowMove = (e: MouseEvent) => {
      if (!panDragRef.current.active) return;
      const rawDx = e.clientX - panDragRef.current.startClientX;
      const rawDy = e.clientY - panDragRef.current.startClientY;
      if (Math.hypot(rawDx, rawDy) > 4) {
        panDragRef.current.moved = true;
      }
      const z = zoomRef.current || 1;
      setPan({
        x: panDragRef.current.origPanX + rawDx / z,
        y: panDragRef.current.origPanY + rawDy / z,
      });
    };

    const finishPan = (e?: MouseEvent) => {
      if (
        e &&
        panDragRef.current.active &&
        !panDragRef.current.moved &&
        panDragRef.current.button === 0 &&
        e.button === 0
      ) {
        // Click on empty canvas deselects current element & hides details pane
        setSelectedLocId(null);
        setSelectedContainerId(null);
        setSelectedGhostLocId?.(null);
        setContextMenu(null);
        setInlineEdgeEdit(null);
      }
      panDragRef.current.active = false;
      setIsPanning(false);
    };

    const handleWindowBlur = () => finishPan();

    window.addEventListener("mousemove", handleWindowMove);
    window.addEventListener("mouseup", finishPan);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("mousemove", handleWindowMove);
      window.removeEventListener("mouseup", finishPan);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [
    isPanning,
    panDragRef,
    setPan,
    setSelectedLocId,
    setSelectedContainerId,
    setSelectedGhostLocId,
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

  const renderedEdges = useMemo(() => {
    const focusedId = selectedContainer?.id || selectedLocation?.id;

    const buildEdgeRenderItem = (params: {
      edge: Pick<
        LocationEdge,
        "id" | "travel_minutes" | "is_locked_or_hidden"
      > & {
        sourceNodeId: string;
        targetNodeId: string;
        isAggregated: boolean;
        containsLockedEdge: boolean;
        rawEdge: LocationEdge;
        groupedEdges?: LocationEdge[];
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
      const groupedCount = edge.groupedEdges?.length ?? 0;
      const labelText = `${edge.travel_minutes}m${
        edge.isAggregated && groupedCount > 1 ? ` · ${groupedCount}` : ""
      }${edge.containsLockedEdge ? " 🔒" : ""}`;
      const badgeWidth = computeDistanceBadgeWidth(labelText);
      return {
        edge,
        clipped,
        isDirect,
        showLabel,
        labelText,
        badgeWidth,
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
      return buildEdgeRenderItem({
        edge,
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
          containsLockedEdge: ge.is_locked_or_hidden,
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
      fallbackMinutes: match ? match.edge.travel_minutes : 1,
    };
  }, [inlineEdgeEdit, renderedEdges]);

  const isEditorQuickDeleteEnabled =
    mode === "editor" &&
    !isMutatingLocked &&
    !inlineEdgeEdit &&
    !nodeDrag &&
    !linkDrag &&
    !isPanning;

  const commitInlineEdgeEdit = () => {
    if (!activeInlineEdge) return;
    const committed = parseCommittedEdgeMinutes(activeInlineEdge.value);
    if (committed !== null) {
      handleUpdateEdgeDistance(activeInlineEdge.edgeId, committed);
    }
    setInlineEdgeEdit(null);
  };

  const stepInlineEdgeEdit = (delta: number) => {
    if (!activeInlineEdge) return;
    setInlineEdgeEdit((prev) =>
      prev
        ? {
            ...prev,
            value: stepEdgeMinutesDraft(
              prev.value,
              delta,
              activeInlineEdge.fallbackMinutes
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
        zoom
      )
    : null;
  const wrapRectForClamp = wrapEl?.getBoundingClientRect();
  const clampedOverlayPos =
    inlineOverlayPoint && wrapRectForClamp && wrapRectForClamp.width > 120
      ? {
          left: Math.max(58, Math.min(wrapRectForClamp.width - 58, inlineOverlayPoint.x)),
          top: Math.max(20, Math.min(wrapRectForClamp.height - 20, inlineOverlayPoint.y)),
        }
      : inlineOverlayPoint
      ? { left: inlineOverlayPoint.x, top: inlineOverlayPoint.y }
      : null;

  const canvasCursor = resolveCanvasCursor({
    isNodeDragging: Boolean(nodeDrag?.hasMoved),
    isLinking: Boolean(linkDrag),
    isPanning,
  });

  return (
    <>
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            viewBox="-340 -260 680 520"
            style={{
              width: "100%",
              height: "100%",
              minHeight: 0,
              cursor: canvasCursor,
              display: "block",
            }}
            onWheel={(e) => {
              e.preventDefault();
              const delta = e.deltaY < 0 ? 0.15 : -0.15;
              setZoom((z) => clampZoom(z + delta));
            }}
            onMouseDown={(e) => {
              if ((e.button !== 0 && e.button !== 1) || nodeDrag || linkDrag) return;
              if (e.button === 1) {
                e.preventDefault();
              }
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
            }}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
              }
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
              {/* Layer 1: Edge Lines & Active Link Rubber-Band */}
              <g data-layer="edge-lines">
                {renderedEdges.map(({ edge, clipped, isDirect, pairKey, isGhost }) => {
                  const openEdgeEdit = (ev: React.MouseEvent) => {
                    ev.stopPropagation();
                    if (edge.isAggregated && edge.groupedEdges) {
                      setMultiEdgeModalEdges(edge.groupedEdges);
                    } else {
                      setInlineEdgeEdit({
                        edgeId: edge.rawEdge.id,
                        midX: clipped.midX,
                        midY: clipped.midY,
                        value: String(edge.travel_minutes),
                      });
                    }
                  };
                  return (
                    <g
                      key={edge.id}
                      onMouseEnter={() => {
                        if (isEditorQuickDeleteEnabled) enterEdgeHover(pairKey);
                      }}
                      onMouseLeave={() => leaveEdgeHover(pairKey)}
                      onContextMenu={(ev) =>
                        openContextMenuAt(ev, {
                          kind: "edge",
                          edgeId: edge.rawEdge.id,
                        })
                      }
                      onDoubleClick={openEdgeEdit}
                    >
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
                        stroke={
                          isGhost
                            ? isDirect
                              ? "#22d3ee"
                              : "#64748b"
                            : isDirect
                            ? "#06b6d4"
                            : edge.isAggregated
                            ? "#475569"
                            : "#334155"
                        }
                        strokeOpacity={isGhost ? (isDirect ? 0.85 : 0.6) : 1}
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
                          isGhost || edge.containsLockedEdge
                            ? "5 4"
                            : edge.isAggregated
                            ? "2 2"
                            : undefined
                        }
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
              </g>

              {/* Layer 2: Opaque Distance Badges (painted above all edge lines) */}
              <g data-layer="edge-badges">
                {renderedEdges.map(
                  ({ edge, clipped, isDirect, showLabel, labelText, badgeWidth, pairKey }) => {
                    if (!showLabel) return null;
                    if (inlineEdgeEdit?.edgeId === edge.rawEdge.id) return null;
                    return (
                      <g
                        key={`badge-${edge.id}`}
                        style={{ cursor: isPanning ? "grabbing" : "pointer" }}
                        onMouseEnter={() => {
                          if (isEditorQuickDeleteEnabled) enterEdgeHover(pairKey);
                        }}
                        onMouseLeave={() => leaveEdgeHover(pairKey)}
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
                              midX: clipped.midX,
                              midY: clipped.midY,
                              value: String(edge.travel_minutes),
                            });
                          }
                        }}
                      >
                        <rect
                          x={clipped.midX - badgeWidth / 2}
                          y={clipped.midY - 9}
                          width={badgeWidth}
                          height={16}
                          rx={4}
                          fill="#0b0e14"
                          fillOpacity={1}
                          stroke={isDirect ? "#0891b2" : "#334155"}
                          strokeWidth={1}
                        />
                        <text
                          x={clipped.midX}
                          y={clipped.midY + 2}
                          textAnchor="middle"
                          fill={isDirect ? "#67e8f9" : "#94a3b8"}
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
                const dropStroke = isDropHover
                  ? nodeDrag!.hoverTarget!.valid
                    ? "#10b981"
                    : "#f43f5e"
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
                        const a = COMPASS_ANGLES[slot];
                        const px = pt.x + Math.cos(a) * (cardW / 2 + 7);
                        const py = pt.y + Math.sin(a) * (cardH / 2 + 7);
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
                                startX: px,
                                startY: py,
                                currX: px,
                                currY: py,
                                hoverTarget: null,
                              });
                            }}
                          >
                            <circle cx={px} cy={py} r={PORT_HIT_RADIUS} fill="transparent" />
                            <circle
                              cx={px}
                              cy={py}
                              r={3.8}
                              fill="#0f172a"
                              stroke="#22d3ee"
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
                    style={{
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

                    {/* 8 Compass Connection Link Ports */}
                    {showPorts &&
                      !isMutatingLocked &&
                      COMPASS_ORDER.map((slot) => {
                        const a = COMPASS_ANGLES[slot];
                        const px = pt.x + Math.cos(a) * LOCATION_PORT_RADIUS;
                        const py = pt.y + Math.sin(a) * LOCATION_PORT_RADIUS;
                        const isOccupied = occupiedSet.has(slot);
                        const isTargetHovered =
                          linkDrag?.hoverTarget?.kind === "location" &&
                          linkDrag.hoverTarget.id === loc.id &&
                          linkDrag.hoverTarget.slot === slot;

                        return (
                          <g
                            key={slot}
                            data-link-port={`${loc.id}:${slot}`}
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
                          >
                            <circle cx={px} cy={py} r={PORT_HIT_RADIUS} fill="transparent" />
                            <circle
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
                    style={{
                      opacity: isSelected ? 0.94 : 0.72,
                      cursor: isPanning ? "grabbing" : "pointer",
                    }}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.stopPropagation();
                      const wpt = clientToWorldPoint(
                        e.clientX,
                        e.clientY,
                        svgRef.current,
                        viewportGroupRef.current,
                        pan,
                        zoom
                      );
                      setNodeDrag({
                        kind: "ghost",
                        id: ghost.destination.id,
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
                      stroke={isSelected ? "#22d3ee" : "#475569"}
                      strokeWidth={isSelected ? 1.8 : 1.2}
                      strokeDasharray="4 3"
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
                  {renderedEdges.map(({ edge, clipped, showLabel, badgeWidth, pairKey }) => {
                    if (!showLabel || hoveredEdgePairKey !== pairKey) return null;
                    // Anchor compact circled X on the top-right corner of the distance badge
                    const qx = clipped.midX + badgeWidth / 2 - 1;
                    const qy = clipped.midY - 9;
                    const deleteTitle =
                      edge.isAggregated &&
                      edge.groupedEdges &&
                      edge.groupedEdges.length > 1
                        ? `Delete all ${edge.groupedEdges.length} linked passages`
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

          {/* HTML Overlay Inline Link Travel-Time Editor */}
          {activeInlineEdge && (
            <div
              data-layer="inline-edge-editor"
              role="group"
              aria-label="Edit link travel time"
              onMouseDown={(ev) => ev.stopPropagation()}
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
                aria-label="Decrease travel minutes"
                title="Decrease (-1m)"
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                }}
                onClick={(ev) => {
                  ev.stopPropagation();
                  stepInlineEdgeEdit(-1);
                }}
                style={{
                  background: "rgba(30, 41, 59, 0.85)",
                  border: "1px solid #334155",
                  borderRadius: 4,
                  color: "#cbd5e1",
                  width: 18,
                  height: 20,
                  fontSize: "12px",
                  lineHeight: "16px",
                  cursor: "pointer",
                  padding: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                −
              </button>
              <input
                ref={inlineInputRef}
                type="text"
                inputMode="numeric"
                aria-label="Travel minutes"
                value={activeInlineEdge.value}
                onChange={(ev) => {
                  const digitsOnly = ev.target.value.replace(/[^\d]/g, "");
                  setInlineEdgeEdit((prev) =>
                    prev ? { ...prev, value: digitsOnly } : null
                  );
                }}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") {
                    ev.preventDefault();
                    commitInlineEdgeEdit();
                  } else if (ev.key === "Escape") {
                    ev.preventDefault();
                    setInlineEdgeEdit(null);
                  } else if (ev.key === "ArrowUp") {
                    ev.preventDefault();
                    stepInlineEdgeEdit(1);
                  } else if (ev.key === "ArrowDown") {
                    ev.preventDefault();
                    stepInlineEdgeEdit(-1);
                  }
                }}
                style={{
                  width: 40,
                  height: 20,
                  fontSize: "12px",
                  fontWeight: 600,
                  textAlign: "center",
                  background: "#111827",
                  color: "#f1f5f9",
                  border: "1px solid #1e293b",
                  borderRadius: 4,
                  outline: "none",
                  padding: "0 2px",
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
              <button
                type="button"
                aria-label="Increase travel minutes"
                title="Increase (+1m)"
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                }}
                onClick={(ev) => {
                  ev.stopPropagation();
                  stepInlineEdgeEdit(1);
                }}
                style={{
                  background: "rgba(30, 41, 59, 0.85)",
                  border: "1px solid #334155",
                  borderRadius: 4,
                  color: "#cbd5e1",
                  width: 18,
                  height: 20,
                  fontSize: "12px",
                  lineHeight: "16px",
                  cursor: "pointer",
                  padding: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                +
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
              maxWidth: "calc(100% - 140px)",
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
              Drag nodes · Middle-drag to pan · Drag ports to link · Double-click distance · Right-click for actions
            </span>
          </div>

          {/* Floating Bottom-Right Zoom Indicator Pill */}
          <div
            data-testid="canvas-zoom-indicator"
            aria-label="Canvas Zoom Indicator"
            style={{
              position: "absolute",
              right: 10,
              bottom: 10,
              background: "rgba(11, 14, 20, 0.92)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 6,
              display: "inline-flex",
              alignItems: "center",
              overflow: "hidden",
              fontSize: "0.7rem",
              zIndex: 15,
            }}
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
    </>
  );
};
