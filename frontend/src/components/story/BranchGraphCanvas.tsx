import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Compass,
  Crosshair,
  Eye,
  EyeOff,
  GitBranch,
  Layers,
  MapPin,
  Maximize2,
  Navigation,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { CampaignStateBundle } from "../../types";
import {
  MAX_GRAPH_ZOOM,
  MIN_GRAPH_ZOOM,
  buildBranchEdgePath,
  buildBranchGraphModel,
  clampGraphZoom,
  computeAncestorPath,
  computeCenterNodeViewport,
  computeFitGraphViewport,
  type BranchGraphNode,
} from "./branchGraphLayout";

export interface BranchGraphCanvasProps {
  bundle: CampaignStateBundle;
  isMutatingLocked?: boolean;
  /** Optional initial selected node ID (defaults to active leaf; useful for SSR tests). */
  initialSelectedNodeId?: string | null;
  onZoomToTurn: (turnId: string) => void;
  onSwitchTimeline: (tipTurnId: string) => Promise<void> | void;
  onBranchFromTurn: (turnId: string) => Promise<void> | void;
}

function clampLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const words = clean.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else if (!current) {
      lines.push(word.slice(0, Math.max(1, maxCharsPerLine - 1)) + "…");
      if (lines.length >= maxLines) return lines;
    } else {
      lines.push(current);
      if (lines.length >= maxLines) {
        const last = lines[maxLines - 1];
        lines[maxLines - 1] =
          last.length >= maxCharsPerLine
            ? last.slice(0, Math.max(1, maxCharsPerLine - 1)) + "…"
            : `${last}…`;
        return lines;
      }
      current = word;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  return lines;
}

function truncateInline(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(1, maxChars - 1))}…`;
}

export const BranchGraphCanvas: React.FC<BranchGraphCanvasProps> = ({
  bundle,
  isMutatingLocked = false,
  initialSelectedNodeId,
  onZoomToTurn,
  onSwitchTimeline,
  onBranchFromTurn,
}) => {
  const activeLeafId =
    bundle.campaign.active_leaf_turn_id ??
    bundle.active_branch_turns[bundle.active_branch_turns.length - 1]?.id ??
    null;

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialSelectedNodeId ?? activeLeafId
  );
  const [expandedAnchors, setExpandedAnchors] = useState<Set<string>>(() => new Set());
  const [showAllSwipes, setShowAllSwipes] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 40, y: 40 });
  const [isPanning, setIsPanning] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const hasInitializedViewportRef = useRef(false);
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

  const locationNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const loc of bundle.visible_locations ?? []) {
      map[loc.id] = loc.name;
    }
    if (bundle.active_location?.id && bundle.active_location?.name) {
      map[bundle.active_location.id] = bundle.active_location.name;
    }
    return map;
  }, [bundle.visible_locations, bundle.active_location]);

  const model = useMemo(
    () =>
      buildBranchGraphModel({
        allTurns: bundle.all_turn_nodes,
        activeBranchTurns: bundle.active_branch_turns,
        activeLeafId,
        episodicChunks: bundle.episodic_chunks,
        locationNamesById,
        expandedSwipeAnchorIds: expandedAnchors,
        showAllSwipes,
      }),
    [
      bundle.all_turn_nodes,
      bundle.active_branch_turns,
      activeLeafId,
      bundle.episodic_chunks,
      locationNamesById,
      expandedAnchors,
      showAllSwipes,
    ]
  );

  // Keep selectedNodeId valid if swipes collapse or turns change
  const effectiveSelectedId =
    selectedNodeId && model.nodeById[selectedNodeId]
      ? selectedNodeId
      : activeLeafId && model.nodeById[activeLeafId]
      ? activeLeafId
      : model.nodes[0]?.id ?? null;

  const selectedNode: BranchGraphNode | null = effectiveSelectedId
    ? model.nodeById[effectiveSelectedId] ?? null
    : null;

  const selectedPath = useMemo(
    () => computeAncestorPath(model.nodeById, effectiveSelectedId),
    [model.nodeById, effectiveSelectedId]
  );

  const getStageSize = useCallback(() => {
    const rect = stageRef.current?.getBoundingClientRect();
    return {
      width: rect && rect.width > 0 ? rect.width : 860,
      height: rect && rect.height > 0 ? rect.height : 420,
    };
  }, []);

  const handleFitGraph = useCallback(() => {
    const { width, height } = getStageSize();
    const next = computeFitGraphViewport(model.bounds, width, height, 48);
    setZoom(next.zoom);
    setPan(next.pan);
  }, [getStageSize, model.bounds]);

  const handleCenterOnActive = useCallback(() => {
    const target =
      (activeLeafId ? model.nodeById[activeLeafId] : null) ?? model.nodes[0];
    if (!target) return;
    const { width, height } = getStageSize();
    const next = computeCenterNodeViewport(target, width, height, Math.max(zoom, 0.85));
    setZoom(next.zoom);
    setPan(next.pan);
  }, [activeLeafId, getStageSize, model.nodeById, model.nodes, zoom]);

  // Initial viewport alignment once mounted
  useEffect(() => {
    if (hasInitializedViewportRef.current || model.nodes.length === 0) return;
    hasInitializedViewportRef.current = true;
    const { width, height } = getStageSize();
    // If graph fits comfortably at >= 0.72 zoom, fit whole graph; otherwise center active leaf at 0.9x
    const fit = computeFitGraphViewport(model.bounds, width, height, 48);
    if (fit.zoom >= 0.72) {
      setZoom(fit.zoom);
      setPan(fit.pan);
    } else {
      const target =
        (activeLeafId ? model.nodeById[activeLeafId] : null) ?? model.nodes[0];
      if (target) {
        const centered = computeCenterNodeViewport(target, width, height, 0.9);
        setZoom(centered.zoom);
        setPan(centered.pan);
      } else {
        setZoom(fit.zoom);
        setPan(fit.pan);
      }
    }
  }, [activeLeafId, getStageSize, model.bounds, model.nodeById, model.nodes]);

  const toggleExpandedAnchor = useCallback((anchorId: string) => {
    setExpandedAnchors((prev) => {
      const next = new Set(prev);
      if (next.has(anchorId)) next.delete(anchorId);
      else next.add(anchorId);
      return next;
    });
  }, []);

  const applyZoomAroundPoint = useCallback(
    (nextZoomRaw: number, clientX?: number, clientY?: number) => {
      const nextZoom = clampGraphZoom(nextZoomRaw);
      const rect = stageRef.current?.getBoundingClientRect();
      const pivotX =
        rect && clientX !== undefined ? clientX - rect.left : (rect?.width ?? 860) / 2;
      const pivotY =
        rect && clientY !== undefined ? clientY - rect.top : (rect?.height ?? 420) / 2;

      setPan((prevPan) => {
        const worldX = (pivotX - prevPan.x) / zoom;
        const worldY = (pivotY - prevPan.y) / zoom;
        return {
          x: pivotX - worldX * nextZoom,
          y: pivotY - worldY * nextZoom,
        };
      });
      setZoom(nextZoom);
    },
    [zoom]
  );

  const handleWheel: React.WheelEventHandler<SVGSVGElement> = (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    applyZoomAroundPoint(zoom * factor, e.clientX, e.clientY);
  };

  const handlePointerDown: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (e.button !== 0) return;
    const target = e.target as Element | null;
    if (target?.closest("[data-graph-interactive='true']")) {
      return;
    }
    panDragRef.current = {
      active: true,
      moved: false,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origPanX: pan.x,
      origPanY: pan.y,
    };
    setIsPanning(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic pointer capture errors
    }
  };

  const handlePointerMove: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (!panDragRef.current.active) return;
    const dx = e.clientX - panDragRef.current.startClientX;
    const dy = e.clientY - panDragRef.current.startClientY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      panDragRef.current.moved = true;
    }
    setPan({
      x: panDragRef.current.origPanX + dx,
      y: panDragRef.current.origPanY + dy,
    });
  };

  const handlePointerUp: React.PointerEventHandler<SVGSVGElement> = (e) => {
    if (!panDragRef.current.active) return;
    panDragRef.current.active = false;
    setIsPanning(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handleTriggerSwitchTimeline = async (tipTurnId: string) => {
    if (isMutatingLocked || isSwitching) return;
    setIsSwitching(true);
    try {
      await onSwitchTimeline(tipTurnId);
    } finally {
      setIsSwitching(false);
    }
  };

  const handleTriggerBranchFrom = async (turnId: string) => {
    if (isMutatingLocked || isSwitching) return;
    setIsSwitching(true);
    try {
      await onBranchFromTurn(turnId);
    } finally {
      setIsSwitching(false);
    }
  };

  if (model.nodes.length === 0) {
    return (
      <div className="branch-graph-empty">
        No turns in this campaign yet.
      </div>
    );
  }

  const nonSwipeNodeCount = model.nodes.filter((n) => !n.isExpandedSwipe).length;

  return (
    <div className="branch-graph-shell">
      {/* Screen-space Header & Pan/Zoom Toolbar */}
      <div className="branch-graph-toolbar">
        <div className="branch-graph-toolbar-title">
          <GitBranch size={15} color="var(--accent-violet)" />
          <span>Branch Graph</span>
          <span className="branch-graph-stats">
            {nonSwipeNodeCount} {nonSwipeNodeCount === 1 ? "turn" : "turns"} ·{" "}
            {model.branchTipCount} {model.branchTipCount === 1 ? "timeline" : "timelines"}
            {model.totalHiddenSwipes > 0 &&
              ` · ${model.totalHiddenSwipes} unfollowed ${
                model.totalHiddenSwipes === 1 ? "swipe" : "swipes"
              }`}
          </span>
        </div>
        <div className="branch-graph-toolbar-actions">
          {model.totalHiddenSwipes > 0 && (
            <button
              type="button"
              className={`btn btn-ghost branch-graph-tool-btn ${
                showAllSwipes ? "active" : ""
              }`}
              onClick={() => setShowAllSwipes((v) => !v)}
              title={
                showAllSwipes
                  ? "Hide unfollowed swipes to declutter graph"
                  : "Show all unfollowed swipes across the graph"
              }
            >
              {showAllSwipes ? <EyeOff size={13} /> : <Eye size={13} />}
              <span>
                {showAllSwipes ? "Hide swipes" : `Show swipes (${model.totalHiddenSwipes})`}
              </span>
            </button>
          )}
          <div className="branch-graph-zoom-group">
            <button
              type="button"
              className="btn btn-ghost branch-graph-icon-btn"
              onClick={() => applyZoomAroundPoint(zoom * 0.85)}
              disabled={zoom <= MIN_GRAPH_ZOOM + 0.01}
              title="Zoom out"
              aria-label="Zoom out"
            >
              <ZoomOut size={14} />
            </button>
            <span className="branch-graph-zoom-pct">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              className="btn btn-ghost branch-graph-icon-btn"
              onClick={() => applyZoomAroundPoint(zoom * 1.18)}
              disabled={zoom >= MAX_GRAPH_ZOOM - 0.01}
              title="Zoom in"
              aria-label="Zoom in"
            >
              <ZoomIn size={14} />
            </button>
          </div>
          <button
            type="button"
            className="btn btn-ghost branch-graph-tool-btn"
            onClick={handleFitGraph}
            title="Fit entire branch graph into view"
          >
            <Maximize2 size={13} />
            <span>Fit</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost branch-graph-tool-btn"
            onClick={handleCenterOnActive}
            title="Center on active turn"
          >
            <Crosshair size={13} />
            <span>Active</span>
          </button>
        </div>
      </div>

      {/* Pan/Zoom SVG Tree Stage */}
      <div
        ref={stageRef}
        className={`branch-graph-stage ${isPanning ? "is-panning" : ""}`}
      >
        <svg
          className="branch-graph-svg"
          role="img"
          aria-label="Campaign Branch Graph"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <defs>
            <pattern
              id="branch-graph-dot-grid"
              width="24"
              height="24"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="2" cy="2" r="1" fill="rgba(148, 163, 184, 0.14)" />
            </pattern>
            <marker
              id="branch-arrow-default"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 1 2 L 8 5 L 1 8 z" fill="rgba(148, 163, 184, 0.55)" />
            </marker>
            <marker
              id="branch-arrow-active"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 1 2 L 8 5 L 1 8 z" fill="#f59e0b" />
            </marker>
            <marker
              id="branch-arrow-selected"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 1 2 L 8 5 L 1 8 z" fill="#22d3ee" />
            </marker>
          </defs>

          <rect width="100%" height="100%" fill="url(#branch-graph-dot-grid)" />

          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* 1. Directed Edges (draw inactive first, active/selected on top) */}
            {model.edges.map((edge) => {
              const fromNode = model.nodeById[edge.fromId];
              const toNode = model.nodeById[edge.toId];
              if (!fromNode || !toNode) return null;
              const isSelectedEdge = selectedPath.edgeIds.has(edge.id);
              const d = buildBranchEdgePath(fromNode, toNode);
              const stroke = isSelectedEdge
                ? "#22d3ee"
                : edge.isActiveBranch
                ? "#f59e0b"
                : edge.isExpandedSwipe
                ? "rgba(148, 163, 184, 0.35)"
                : "rgba(148, 163, 184, 0.45)";
              const strokeWidth = isSelectedEdge ? 2.75 : edge.isActiveBranch ? 2.25 : 1.5;
              const markerEnd = isSelectedEdge
                ? "url(#branch-arrow-selected)"
                : edge.isActiveBranch
                ? "url(#branch-arrow-active)"
                : "url(#branch-arrow-default)";

              return (
                <path
                  key={edge.id}
                  d={d}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                  strokeDasharray={edge.isExpandedSwipe ? "5 4" : undefined}
                  markerEnd={markerEnd}
                  className={
                    isSelectedEdge
                      ? "branch-edge branch-edge--selected"
                      : edge.isActiveBranch
                      ? "branch-edge branch-edge--active"
                      : "branch-edge"
                  }
                />
              );
            })}

            {/* 2. Tree Nodes */}
            {model.nodes.map((node) => {
              const isSelected = node.id === effectiveSelectedId;
              const inSelectedPath = selectedPath.nodeIds.has(node.id);
              const topY = node.y - node.height / 2;
              const isSwipeAnchorExpanded =
                showAllSwipes || expandedAnchors.has(node.id);
              const swipeCount = node.hiddenSwipes.length;

              const strokeColor = isSelected
                ? "#22d3ee"
                : inSelectedPath
                ? "rgba(34, 211, 238, 0.72)"
                : node.isActiveLeaf
                ? "#f59e0b"
                : node.isActiveBranch
                ? "rgba(245, 158, 11, 0.65)"
                : node.isExpandedSwipe
                ? "rgba(148, 163, 184, 0.38)"
                : node.isBranchTip
                ? "rgba(167, 139, 250, 0.65)"
                : "rgba(148, 163, 184, 0.28)";

              const fillColor = isSelected
                ? "rgba(14, 116, 144, 0.28)"
                : node.isActiveLeaf
                ? "rgba(245, 158, 11, 0.14)"
                : node.isActiveBranch
                ? "rgba(30, 41, 59, 0.94)"
                : node.isExpandedSwipe
                ? "rgba(15, 23, 42, 0.68)"
                : "rgba(15, 23, 42, 0.88)";

              const handleNodeClick = (e: React.MouseEvent) => {
                e.stopPropagation();
                setSelectedNodeId(node.id);
              };

              const handleNodeDoubleClick = (e: React.MouseEvent) => {
                e.stopPropagation();
                if (!node.isActiveBranch && node.isBranchTip && !isMutatingLocked) {
                  void handleTriggerSwitchTimeline(node.id);
                }
              };

              if (node.kind === "waypoint") {
                const label = truncateInline(node.locationName || "Map Move", 18);
                return (
                  <g
                    key={node.id}
                    data-graph-interactive="true"
                    data-graph-node-id={node.id}
                    data-graph-node-kind="waypoint"
                    transform={`translate(${node.x}, ${topY})`}
                    style={{ cursor: "pointer" }}
                    onClick={handleNodeClick}
                    onDoubleClick={handleNodeDoubleClick}
                  >
                    <rect
                      x={0}
                      y={0}
                      width={node.width}
                      height={node.height}
                      rx={node.height / 2}
                      fill={fillColor}
                      stroke={strokeColor}
                      strokeWidth={isSelected ? 2.2 : 1.4}
                    />
                    <circle
                      cx={16}
                      cy={node.height / 2}
                      r={4}
                      fill={node.isActiveBranch ? "#34d399" : "#94a3b8"}
                    />
                    <text
                      x={27}
                      y={node.height / 2 + 4}
                      fill="#e2e8f0"
                      fontSize="11"
                      fontWeight="600"
                    >
                      {label}
                    </text>
                  </g>
                );
              }

              const maxLines = node.kind === "swipe" ? 1 : 2;
              const maxChars = node.kind === "swipe" ? 24 : 30;
              const descPrefix = node.hasNotableSummary ? "★ " : "";
              const descLines = clampLines(
                `${descPrefix}${node.description}`,
                maxChars,
                maxLines
              );
              const badgeText = node.isActiveLeaf
                ? "ACTIVE"
                : node.isExpandedSwipe
                ? "SWIPE"
                : !node.isActiveBranch && node.isBranchTip
                ? "TIP"
                : null;
              const badgeColor = node.isActiveLeaf
                ? "#f59e0b"
                : node.isExpandedSwipe
                ? "#94a3b8"
                : "#a78bfa";
              const timeStr =
                node.turn.world_snapshot?.world_timestamp?.split(" ")[1] ?? "";

              return (
                <g
                  key={node.id}
                  data-graph-interactive="true"
                  data-graph-node-id={node.id}
                  data-graph-node-kind={node.kind}
                  transform={`translate(${node.x}, ${topY})`}
                  style={{ cursor: "pointer" }}
                  onClick={handleNodeClick}
                  onDoubleClick={handleNodeDoubleClick}
                >
                  <rect
                    x={0}
                    y={0}
                    width={node.width}
                    height={node.height}
                    rx={10}
                    fill={fillColor}
                    stroke={strokeColor}
                    strokeWidth={isSelected ? 2.4 : node.isActiveLeaf ? 2 : 1.3}
                    strokeDasharray={node.isExpandedSwipe ? "5 3" : undefined}
                    opacity={node.isExpandedSwipe && !isSelected ? 0.82 : 1}
                  />

                  {/* Top Row: Turn #N, Badge, Time */}
                  <text
                    x={12}
                    y={20}
                    fill={
                      isSelected
                        ? "#67e8f9"
                        : node.isActiveLeaf
                        ? "#fbbf24"
                        : node.isActiveBranch
                        ? "#f8fafc"
                        : "#cbd5e1"
                    }
                    fontSize="11.5"
                    fontWeight="700"
                  >
                    Turn #{node.depth}
                  </text>

                  {badgeText && (
                    <g transform="translate(68, 9)">
                      <rect
                        x={0}
                        y={0}
                        width={badgeText.length * 6.4 + 10}
                        height={15}
                        rx={4}
                        fill="rgba(15, 23, 42, 0.72)"
                        stroke={badgeColor}
                        strokeWidth={0.9}
                      />
                      <text
                        x={5}
                        y={10.5}
                        fill={badgeColor}
                        fontSize="8.5"
                        fontWeight="700"
                        letterSpacing="0.04em"
                      >
                        {badgeText}
                      </text>
                    </g>
                  )}

                  {node.episodicChunkLabel && (
                    <circle
                      cx={node.width - (timeStr ? 46 : 14)}
                      cy={16}
                      r={3.5}
                      fill="#f59e0b"
                    >
                      <title>{`Episodic Summary Milestone (${node.episodicChunkLabel})`}</title>
                    </circle>
                  )}

                  {timeStr && (
                    <text
                      x={node.width - 10}
                      y={19.5}
                      textAnchor="end"
                      fill="#94a3b8"
                      fontSize="9.5"
                    >
                      {timeStr}
                    </text>
                  )}

                  {/* Description lines (Notable Summary or Prompt Fallback) */}
                  {descLines.map((line, lineIdx) => (
                    <text
                      key={lineIdx}
                      x={12}
                      y={39 + lineIdx * 15}
                      fill={
                        node.hasNotableSummary
                          ? "#fde68a"
                          : node.isExpandedSwipe
                          ? "#94a3b8"
                          : "#cbd5e1"
                      }
                      fontSize="10.8"
                      fontWeight={node.hasNotableSummary ? "600" : "400"}
                    >
                      {line}
                    </text>
                  ))}

                  {/* Separate Clickable "+N swipes" Pill (bottom-right corner) */}
                  {swipeCount > 0 && (
                    <g
                      data-graph-interactive="true"
                      data-swipe-expand-anchor={node.id}
                      transform={`translate(${node.width - 78}, ${node.height - 12})`}
                      style={{ cursor: "pointer" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpandedAnchor(node.id);
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                      {/* Wide transparent hit target */}
                      <rect
                        x={-6}
                        y={-6}
                        width={84}
                        height={30}
                        fill="transparent"
                      />
                      <rect
                        x={0}
                        y={0}
                        width={72}
                        height={18}
                        rx={9}
                        fill={
                          isSwipeAnchorExpanded
                            ? "rgba(34, 211, 238, 0.22)"
                            : "rgba(30, 41, 59, 0.96)"
                        }
                        stroke={
                          isSwipeAnchorExpanded
                            ? "#22d3ee"
                            : "rgba(148, 163, 184, 0.5)"
                        }
                        strokeWidth={1}
                      />
                      <text
                        x={36}
                        y={12}
                        textAnchor="middle"
                        fill={isSwipeAnchorExpanded ? "#67e8f9" : "#cbd5e1"}
                        fontSize="9.2"
                        fontWeight="600"
                      >
                        {isSwipeAnchorExpanded
                          ? `Hide (${swipeCount})`
                          : `+${swipeCount} ${swipeCount === 1 ? "swipe" : "swipes"}`}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Screen-Space HTML Node Detail & Action Bar (outside <svg>) */}
      {selectedNode && (
        <div className="branch-graph-detail-bar" data-selected-turn-id={selectedNode.id}>
          <div className="branch-graph-detail-info">
            <div className="branch-graph-detail-head">
              <strong className="branch-graph-detail-turn">
                Turn #{selectedNode.depth}
              </strong>
              <span
                className={`branch-graph-status-pill ${
                  selectedNode.isActiveLeaf
                    ? "status-active-leaf"
                    : selectedNode.isActiveBranch
                    ? "status-active"
                    : selectedNode.isExpandedSwipe
                    ? "status-swipe"
                    : selectedNode.isBranchTip
                    ? "status-tip"
                    : "status-alt"
                }`}
              >
                {selectedNode.isActiveLeaf
                  ? "Active Tip"
                  : selectedNode.isActiveBranch
                  ? "On Active Timeline"
                  : selectedNode.isExpandedSwipe
                  ? "Unfollowed Swipe"
                  : selectedNode.isBranchTip
                  ? "Alternate Tip"
                  : "Alternate Branch"}
              </span>
              <span className="branch-graph-detail-meta">
                <MapPin size={11} />
                {selectedNode.locationName}
              </span>
              <span className="branch-graph-detail-meta">
                {selectedNode.turn.world_snapshot.world_timestamp}
              </span>
              {selectedNode.episodicChunkLabel && (
                <span className="branch-graph-chunk-badge">
                  <Sparkles size={10} />
                  Summary: {selectedNode.episodicChunkLabel}
                </span>
              )}
            </div>

            {selectedNode.hasNotableSummary && (
              <div className="branch-graph-detail-summary">
                ★ {selectedNode.description}
              </div>
            )}

            <div className="branch-graph-detail-prompt">
              {selectedNode.kind === "opening" ? (
                <span>Opening Scene</span>
              ) : selectedNode.kind === "waypoint" ? (
                <span>
                  <Compass size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                  Map Move to {selectedNode.locationName}
                </span>
              ) : (
                <span>
                  <strong>Prompt:</strong>{" "}
                  {truncateInline(selectedNode.turn.user_message || "[Narrator Turn]", 180)}
                </span>
              )}
            </div>

            {selectedNode.turn.raw_prose && (
              <div className="branch-graph-detail-prose">
                {truncateInline(selectedNode.turn.raw_prose, 210)}
              </div>
            )}
          </div>

          <div className="branch-graph-detail-actions">
            {/* Zoom to moment: ONLY shown on the currently active timeline */}
            {selectedNode.isActiveBranch && (
              <button
                type="button"
                className="btn btn-cyan"
                onClick={() => onZoomToTurn(selectedNode.id)}
                title="Close modal and scroll chat to this turn"
              >
                <Navigation size={13} />
                <span>Zoom to moment</span>
              </button>
            )}

            {/* Switch to this timeline: ONLY on alternate branch tips or interior alternate nodes with a single unique tip */}
            {!selectedNode.isActiveBranch &&
              selectedNode.uniqueDescendantTipId !== null && (
                <button
                  type="button"
                  className="btn btn-amber"
                  disabled={isMutatingLocked || isSwitching}
                  onClick={() =>
                    void handleTriggerSwitchTimeline(selectedNode.uniqueDescendantTipId!)
                  }
                  title="Load this alternate timeline and continue from its latest turn"
                >
                  <GitBranch size={13} />
                  <span>Switch to this timeline</span>
                </button>
              )}

            {/* Branch from here: always available on any interior (non-leaf) node */}
            {!selectedNode.isBranchTip && !selectedNode.isExpandedSwipe && (
              <button
                type="button"
                className="btn"
                disabled={isMutatingLocked || isSwitching}
                onClick={() => void handleTriggerBranchFrom(selectedNode.id)}
                title={`Rewind to Turn #${selectedNode.depth} and start a new branch from here`}
              >
                <GitBranch size={13} />
                <span>Branch from here</span>
              </button>
            )}

            {/* Per-node unfollowed swipe toggle */}
            {selectedNode.hiddenSwipes.length > 0 && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => toggleExpandedAnchor(selectedNode.id)}
              >
                <Layers size={13} />
                <span>
                  {showAllSwipes || expandedAnchors.has(selectedNode.id)
                    ? `Hide ${selectedNode.hiddenSwipes.length} ${
                        selectedNode.hiddenSwipes.length === 1 ? "swipe" : "swipes"
                      }`
                    : `Show ${selectedNode.hiddenSwipes.length} unfollowed ${
                        selectedNode.hiddenSwipes.length === 1 ? "swipe" : "swipes"
                      }`}
                </span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
