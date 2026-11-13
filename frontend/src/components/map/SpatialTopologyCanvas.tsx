import React from "react";
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
  COMPASS_ANGLES,
  COMPASS_ORDER,
  clientToWorldPoint,
  type LinkDragState,
  type NodeDragState,
  type ProjectedDepthTopology,
} from "./topologyProjection";

export interface SpatialTopologyCanvasProps {
  svgRef: React.RefObject<SVGSVGElement>;
  viewportGroupRef: React.RefObject<SVGGElement>;
  panDragRef: React.MutableRefObject<{
    active: boolean;
    moved: boolean;
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
  selectedContainer: LocationContainer | null;
  selectedLocation: LocationNode | null;
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
  setContextMenu: React.Dispatch<React.SetStateAction<MapContextMenuState | null>>;
  setMultiEdgeModalEdges: React.Dispatch<React.SetStateAction<LocationEdge[] | null>>;
  openContextMenuAt: (e: React.MouseEvent, target: MapContextMenuState["target"]) => void;
  handleUpdateEdgeDistance: (edgeId: string, minutes: number) => void;
  drillIntoContainer: (contId: string | null) => void;
}

export const SpatialTopologyCanvas: React.FC<SpatialTopologyCanvasProps> = ({
  svgRef,
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
  selectedContainer,
  selectedLocation,
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
  setContextMenu,
  setMultiEdgeModalEdges,
  openContextMenuAt,
  handleUpdateEdgeDistance,
  drillIntoContainer,
}) => {
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
    </>
  );
};
