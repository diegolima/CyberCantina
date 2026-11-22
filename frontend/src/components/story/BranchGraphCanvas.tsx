import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Compass,
  Crosshair,
  Eye,
  EyeOff,
  GitBranch,
  Layers,
  MapPin,
  Maximize2,
  Minimize2,
  Navigation,
  ScrollText,
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
  computeBranchEdgeLabelPoint,
  computeCenterNodeViewport,
  computeFitGraphViewport,
  findContainingEpisodeId,
  type BranchGraphNode,
  type EpisodeGroupMeta,
} from "./branchGraphLayout";

export interface BranchGraphCanvasProps {
  bundle: CampaignStateBundle;
  isMutatingLocked?: boolean;
  /** Optional initial selected node ID (defaults to active leaf; useful for SSR tests). */
  initialSelectedNodeId?: string | null;
  /** Optional initial episode expand/collapse overrides (helpful in SSR tests). */
  initialEpisodeExpandOverrides?: Record<string, boolean>;
  /** When true, center the initial viewport directly on `initialSelectedNodeId`. */
  focusSelectedOnMount?: boolean;
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

function formatEpisodeRange(ep: EpisodeGroupMeta): string {
  return ep.startDepth === ep.endDepth
    ? `Turn ${ep.startDepth}`
    : `Turns ${ep.startDepth}–${ep.endDepth}`;
}

export const BranchGraphCanvas: React.FC<BranchGraphCanvasProps> = ({
  bundle,
  isMutatingLocked = false,
  initialSelectedNodeId,
  initialEpisodeExpandOverrides,
  focusSelectedOnMount = false,
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
  const [episodeExpandOverrides, setEpisodeExpandOverrides] = useState<Record<string, boolean>>(
    () => {
      const next: Record<string, boolean> = { ...(initialEpisodeExpandOverrides ?? {}) };
      if (initialSelectedNodeId) {
        const epId = findContainingEpisodeId(
          {
            allTurns: bundle.all_turn_nodes,
            activeBranchTurns: bundle.active_branch_turns,
            activeLeafId,
            episodicChunks: bundle.episodic_chunks,
            allEpisodicChunks: bundle.all_episodic_chunks,
          },
          initialSelectedNodeId
        );
        if (epId && next[epId] === undefined) {
          next[epId] = true;
        }
      }
      return next;
    }
  );
  const [variantIndexByEpisode, setVariantIndexByEpisode] = useState<Record<string, number>>({});
  const [showAllSwipes, setShowAllSwipes] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 40, y: 40 });
  const [isPanning, setIsPanning] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const hasInitializedViewportRef = useRef(false);
  const prevActiveLeafRef = useRef<string | null>(activeLeafId);
  const pendingPanAnchorRef = useRef<{
    targetNodeId: string;
    oldWorldX: number;
    oldWorldY: number;
  } | null>(null);
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

  // Reset per-episode overrides when the active timeline leaf changes so active-tip auto-expansion applies cleanly
  useEffect(() => {
    if (prevActiveLeafRef.current !== activeLeafId) {
      prevActiveLeafRef.current = activeLeafId;
      setEpisodeExpandOverrides({});
      setVariantIndexByEpisode({});
    }
  }, [activeLeafId]);

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
        allEpisodicChunks: bundle.all_episodic_chunks,
        locationNamesById,
        expandedSwipeAnchorIds: expandedAnchors,
        episodeExpandOverrides,
        showAllSwipes,
      }),
    [
      bundle.all_turn_nodes,
      bundle.active_branch_turns,
      activeLeafId,
      bundle.episodic_chunks,
      bundle.all_episodic_chunks,
      locationNamesById,
      expandedAnchors,
      episodeExpandOverrides,
      showAllSwipes,
    ]
  );

  // Apply pan anchoring after episode expand/collapse so the toggled episode stays pinned on screen
  useEffect(() => {
    const anchor = pendingPanAnchorRef.current;
    if (!anchor) return;
    pendingPanAnchorRef.current = null;
    const nextNode = model.nodeById[anchor.targetNodeId];
    if (!nextNode) return;
    const dx = (nextNode.x - anchor.oldWorldX) * zoom;
    const dy = (nextNode.y - anchor.oldWorldY) * zoom;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      setPan((prev) => ({ x: prev.x - dx, y: prev.y - dy }));
    }
  }, [model, zoom]);

  // Keep selectedNodeId valid across swipe/episode collapse or turn changes
  const activeLeafContainingEpisodeId = useMemo(
    () => model.episodes.find((ep) => ep.containsActiveLeaf && model.nodeById[ep.id])?.id ?? null,
    [model.episodes, model.nodeById]
  );

  const effectiveSelectedId =
    selectedNodeId && model.nodeById[selectedNodeId]
      ? selectedNodeId
      : activeLeafId && model.nodeById[activeLeafId]
      ? activeLeafId
      : activeLeafContainingEpisodeId ?? model.nodes[0]?.id ?? null;

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
      (activeLeafId ? model.nodeById[activeLeafId] : null) ??
      (activeLeafContainingEpisodeId ? model.nodeById[activeLeafContainingEpisodeId] : null) ??
      model.nodes[0];
    if (!target) return;
    const { width, height } = getStageSize();
    const next = computeCenterNodeViewport(target, width, height, Math.max(zoom, 0.85));
    setZoom(next.zoom);
    setPan(next.pan);
  }, [
    activeLeafContainingEpisodeId,
    activeLeafId,
    getStageSize,
    model.nodeById,
    model.nodes,
    zoom,
  ]);

  // Keep selectedNodeId and enclosing episode expansion synced if initialSelectedNodeId changes while mounted
  const prevInitialSelectedRef = useRef<string | null | undefined>(initialSelectedNodeId);
  useEffect(() => {
    if (prevInitialSelectedRef.current === initialSelectedNodeId) return;
    prevInitialSelectedRef.current = initialSelectedNodeId;
    if (!initialSelectedNodeId) return;
    setSelectedNodeId(initialSelectedNodeId);
    const epId = findContainingEpisodeId(
      {
        allTurns: bundle.all_turn_nodes,
        activeBranchTurns: bundle.active_branch_turns,
        activeLeafId,
        episodicChunks: bundle.episodic_chunks,
        allEpisodicChunks: bundle.all_episodic_chunks,
      },
      initialSelectedNodeId
    );
    if (epId) {
      setEpisodeExpandOverrides((prev) => (prev[epId] ? prev : { ...prev, [epId]: true }));
    }
  }, [
    activeLeafId,
    bundle.active_branch_turns,
    bundle.all_episodic_chunks,
    bundle.all_turn_nodes,
    bundle.episodic_chunks,
    initialSelectedNodeId,
  ]);

  // Initial viewport alignment once mounted
  useEffect(() => {
    if (hasInitializedViewportRef.current || model.nodes.length === 0) return;
    hasInitializedViewportRef.current = true;
    const { width, height } = getStageSize();
    const explicitTarget = initialSelectedNodeId
      ? model.nodeById[initialSelectedNodeId] ?? null
      : null;

    if (focusSelectedOnMount && explicitTarget) {
      const centered = computeCenterNodeViewport(explicitTarget, width, height, 0.92);
      setZoom(centered.zoom);
      setPan(centered.pan);
      return;
    }

    const fit = computeFitGraphViewport(model.bounds, width, height, 48);
    if (fit.zoom >= 0.72) {
      setZoom(fit.zoom);
      setPan(fit.pan);
    } else {
      const target =
        explicitTarget ??
        (activeLeafId ? model.nodeById[activeLeafId] : null) ??
        (activeLeafContainingEpisodeId ? model.nodeById[activeLeafContainingEpisodeId] : null) ??
        model.nodes[0];
      if (target) {
        const centered = computeCenterNodeViewport(target, width, height, 0.9);
        setZoom(centered.zoom);
        setPan(centered.pan);
      } else {
        setZoom(fit.zoom);
        setPan(fit.pan);
      }
    }
  }, [
    activeLeafContainingEpisodeId,
    activeLeafId,
    focusSelectedOnMount,
    getStageSize,
    initialSelectedNodeId,
    model.bounds,
    model.nodeById,
    model.nodes,
  ]);

  const toggleExpandedAnchor = useCallback((anchorId: string) => {
    setExpandedAnchors((prev) => {
      const next = new Set(prev);
      if (next.has(anchorId)) next.delete(anchorId);
      else next.add(anchorId);
      return next;
    });
  }, []);

  const toggleEpisodeExpanded = useCallback(
    (episodeId: string, expand: boolean) => {
      const ep = model.episodeById[episodeId];
      if (!ep) return;

      if (expand) {
        const epNode = model.nodeById[episodeId];
        const firstTurnId = ep.turnIds[0];
        if (epNode && firstTurnId) {
          pendingPanAnchorRef.current = {
            targetNodeId: firstTurnId,
            oldWorldX: epNode.x,
            oldWorldY: epNode.y,
          };
        }
        if (effectiveSelectedId === episodeId) {
          setSelectedNodeId(
            ep.containsActiveLeaf && activeLeafId ? activeLeafId : firstTurnId ?? null
          );
        }
      } else {
        const firstTurnNode = model.nodeById[ep.turnIds[0]];
        if (firstTurnNode) {
          pendingPanAnchorRef.current = {
            targetNodeId: episodeId,
            oldWorldX: firstTurnNode.x,
            oldWorldY: firstTurnNode.y,
          };
        }
        if (effectiveSelectedId && ep.turnIds.includes(effectiveSelectedId)) {
          setSelectedNodeId(episodeId);
        }
      }

      setEpisodeExpandOverrides((prev) => ({
        ...prev,
        [episodeId]: expand,
      }));
    },
    [activeLeafId, effectiveSelectedId, model.episodeById, model.nodeById]
  );

  const handleToggleAllEpisodes = useCallback(() => {
    if (model.episodes.length === 0) return;
    const shouldExpandAll = model.collapsedEpisodeCount > 0;
    const next: Record<string, boolean> = {};
    for (const ep of model.episodes) {
      next[ep.id] = shouldExpandAll;
    }
    setEpisodeExpandOverrides(next);
  }, [model.collapsedEpisodeCount, model.episodes]);

  const stepEpisodeVariant = useCallback(
    (episodeId: string, delta: number) => {
      const ep = model.episodeById[episodeId];
      if (!ep || ep.summaryVariants.length <= 1) return;
      const total = ep.summaryVariants.length;
      setVariantIndexByEpisode((prev) => {
        const curr = prev[episodeId] ?? 0;
        const nextIdx = (((curr + delta) % total) + total) % total;
        return { ...prev, [episodeId]: nextIdx };
      });
    },
    [model.episodeById]
  );

  const getActiveVariant = useCallback(
    (ep: EpisodeGroupMeta) => {
      const total = ep.summaryVariants.length;
      if (total === 0) {
        return {
          index: 0,
          variant: {
            kind: "in_progress" as const,
            chunkId: null,
            title: "Episode in Progress",
            synopsis: formatEpisodeRange(ep),
            summaryText: "",
            rangeLabel: formatEpisodeRange(ep),
            sourceLabel: null,
            leafTurnId: null,
          },
        };
      }
      const raw = variantIndexByEpisode[ep.id] ?? 0;
      const index = ((raw % total) + total) % total;
      return { index, variant: ep.summaryVariants[index] };
    },
    [variantIndexByEpisode]
  );

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

  const selectedEpisodeGroup =
    selectedNode?.kind === "episode" ? selectedNode.episodeGroup : null;
  const selectedEpisodeVariantInfo = selectedEpisodeGroup
    ? getActiveVariant(selectedEpisodeGroup)
    : null;

  return (
    <div className="branch-graph-shell">
      {/* Screen-space Header & Pan/Zoom Toolbar */}
      <div className="branch-graph-toolbar">
        <div className="branch-graph-toolbar-title">
          <GitBranch size={15} color="var(--accent-violet)" />
          <span>Branch Graph</span>
          <span className="branch-graph-stats">
            {model.totalTurnCount} {model.totalTurnCount === 1 ? "turn" : "turns"}
            {model.collapsedEpisodeCount > 0 &&
              ` (${model.collapsedEpisodeCount} ${
                model.collapsedEpisodeCount === 1 ? "episode" : "episodes"
              } collapsed)`}{" "}
            · {model.branchTipCount} {model.branchTipCount === 1 ? "timeline" : "timelines"}
            {model.totalHiddenSwipes > 0 &&
              ` · ${model.totalHiddenSwipes} unfollowed ${
                model.totalHiddenSwipes === 1 ? "swipe" : "swipes"
              }`}
          </span>
        </div>
        <div className="branch-graph-toolbar-actions">
          {model.episodes.length > 0 && (
            <button
              type="button"
              className={`btn btn-ghost branch-graph-tool-btn ${
                model.collapsedEpisodeCount === 0 ? "active" : ""
              }`}
              onClick={handleToggleAllEpisodes}
              title={
                model.collapsedEpisodeCount > 0
                  ? "Expand all summarized episodes into individual turns"
                  : "Collapse all summarized episodes into summary nodes"
              }
            >
              {model.collapsedEpisodeCount > 0 ? (
                <ScrollText size={13} />
              ) : (
                <Minimize2 size={13} />
              )}
              <span>
                {model.collapsedEpisodeCount > 0 ? "Expand episodes" : "Collapse episodes"}
              </span>
            </button>
          )}
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
            {/* 0. Expanded Episode Group Frames & Collapse Pills (behind edges and nodes) */}
            {model.expandedEpisodeFrames.map((frame) => {
              const ep = frame.episode;
              const isEpActive = ep.intersectsActiveBranch;
              const pillW = 74;
              const pillX = Math.max(frame.headerX + 8, frame.headerX + frame.headerWidth - pillW - 8);
              return (
                <g key={frame.episodeId} data-expanded-episode-frame={frame.episodeId}>
                  {frame.segments.map((seg, segIdx) => (
                    <rect
                      key={segIdx}
                      x={seg.minX}
                      y={seg.minY}
                      width={Math.max(1, seg.maxX - seg.minX)}
                      height={Math.max(1, seg.maxY - seg.minY)}
                      rx={12}
                      fill={
                        isEpActive
                          ? "rgba(245, 158, 11, 0.045)"
                          : "rgba(148, 163, 184, 0.04)"
                      }
                      stroke={
                        isEpActive
                          ? "rgba(245, 158, 11, 0.34)"
                          : "rgba(148, 163, 184, 0.28)"
                      }
                      strokeWidth={1.1}
                      strokeDasharray="6 4"
                    />
                  ))}
                  <text
                    x={frame.headerX + 10}
                    y={frame.headerY + 15}
                    fill={isEpActive ? "#fcd34d" : "#94a3b8"}
                    fontSize="9.8"
                    fontWeight="700"
                    letterSpacing="0.03em"
                  >
                    {`EPISODE ${ep.episodeIndex} · ${formatEpisodeRange(ep).toUpperCase()}`}
                  </text>
                  <g
                    data-graph-interactive="true"
                    data-episode-collapse-id={ep.id}
                    transform={`translate(${pillX}, ${frame.headerY + 3})`}
                    style={{ cursor: "pointer" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleEpisodeExpanded(ep.id, false);
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    <rect x={-4} y={-4} width={pillW + 8} height={24} fill="transparent" />
                    <rect
                      x={0}
                      y={0}
                      width={pillW}
                      height={16}
                      rx={8}
                      fill="rgba(15, 23, 42, 0.92)"
                      stroke={
                        isEpActive
                          ? "rgba(245, 158, 11, 0.55)"
                          : "rgba(148, 163, 184, 0.45)"
                      }
                      strokeWidth={1}
                    />
                    <text
                      x={pillW / 2}
                      y={11}
                      textAnchor="middle"
                      fill={isEpActive ? "#fde68a" : "#cbd5e1"}
                      fontSize="9"
                      fontWeight="600"
                    >
                      Collapse
                    </text>
                    <title>{`Collapse Episode ${ep.episodeIndex} (${formatEpisodeRange(ep)})`}</title>
                  </g>
                </g>
              );
            })}

            {/* 1. Directed Edges (draw inactive first, active/selected on top) */}
            {model.edges.map((edge) => {
              const fromNode = model.nodeById[edge.fromId];
              const toNode = model.nodeById[edge.toId];
              if (!fromNode || !toNode) return null;
              const isSelectedEdge = selectedPath.edgeIds.has(edge.id);
              const isInsideExpandedEpisode =
                fromNode.memberEpisodeId !== null &&
                fromNode.memberEpisodeId === toNode.memberEpisodeId;
              const d = buildBranchEdgePath(fromNode, toNode);
              const stroke = isInsideExpandedEpisode
                ? isSelectedEdge || edge.isActiveBranch
                  ? "#f59e0b"
                  : "rgba(245, 158, 11, 0.72)"
                : isSelectedEdge
                ? "#22d3ee"
                : edge.isActiveBranch
                ? "rgba(34, 211, 238, 0.78)"
                : edge.isExpandedSwipe
                ? "rgba(148, 163, 184, 0.35)"
                : "rgba(148, 163, 184, 0.45)";
              const strokeWidth = isSelectedEdge
                ? 2.75
                : edge.isActiveBranch || isInsideExpandedEpisode
                ? 2.25
                : 1.5;
              const markerEnd = isInsideExpandedEpisode
                ? "url(#branch-arrow-active)"
                : isSelectedEdge || edge.isActiveBranch
                ? "url(#branch-arrow-selected)"
                : "url(#branch-arrow-default)";

              const showOriginLabel =
                fromNode.kind === "episode" &&
                fromNode.episodeGroup !== null &&
                edge.originTurnDepth !== null &&
                (fromNode.episodeGroup.outgoingBranchCount >= 2 ||
                  edge.originTurnDepth !== fromNode.episodeGroup.endDepth);
              const labelPos = showOriginLabel
                ? computeBranchEdgeLabelPoint(fromNode, toNode, 0.46)
                : null;

              return (
                <g key={edge.id}>
                  <path
                    data-edge-id={edge.id}
                    d={d}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={strokeWidth}
                    strokeDasharray={edge.isExpandedSwipe ? "5 4" : undefined}
                    markerEnd={markerEnd}
                    className={
                      isInsideExpandedEpisode
                        ? "branch-edge branch-edge--episode"
                        : isSelectedEdge
                        ? "branch-edge branch-edge--selected"
                        : edge.isActiveBranch
                        ? "branch-edge branch-edge--active"
                        : "branch-edge"
                    }
                  />
                  {showOriginLabel && labelPos && edge.originTurnDepth !== null && (
                    <g
                      transform={`translate(${labelPos.x - 24}, ${labelPos.y - 8})`}
                      data-edge-origin-turn={edge.originTurnDepth}
                    >
                      <rect
                        x={0}
                        y={0}
                        width={48}
                        height={15}
                        rx={7.5}
                        fill="rgba(15, 23, 42, 0.94)"
                        stroke={
                          isSelectedEdge || edge.isActiveBranch
                            ? "rgba(34, 211, 238, 0.7)"
                            : "rgba(148, 163, 184, 0.45)"
                        }
                        strokeWidth={0.9}
                      />
                      <text
                        x={24}
                        y={10.5}
                        textAnchor="middle"
                        fill={
                          isSelectedEdge || edge.isActiveBranch ? "#67e8f9" : "#cbd5e1"
                        }
                        fontSize="8.5"
                        fontWeight="600"
                      >
                        {`from #${edge.originTurnDepth}`}
                      </text>
                      <title>{`Branched from Turn #${edge.originTurnDepth}`}</title>
                    </g>
                  )}
                </g>
              );
            })}

            {/* 2. Tree Nodes */}
            {model.nodes.map((node) => {
              const isSelected = node.id === effectiveSelectedId;
              const inSelectedPath = selectedPath.nodeIds.has(node.id);
              const isInExpandedEpisode = node.memberEpisodeId !== null;
              const topY = node.y - node.height / 2;
              const isSwipeAnchorExpanded =
                showAllSwipes || expandedAnchors.has(node.id);
              const swipeCount = node.hiddenSwipes.length;

              const strokeColor = isInExpandedEpisode
                ? isSelected
                  ? "#fbbf24"
                  : inSelectedPath || node.isActiveBranch
                  ? "#f59e0b"
                  : "rgba(245, 158, 11, 0.65)"
                : node.kind === "episode"
                ? isSelected
                  ? "#22d3ee"
                  : inSelectedPath
                  ? "rgba(34, 211, 238, 0.78)"
                  : node.isActiveLeaf
                  ? "#f59e0b"
                  : node.isActiveBranch
                  ? "rgba(245, 158, 11, 0.75)"
                  : "rgba(167, 139, 250, 0.55)"
                : isSelected
                ? "#22d3ee"
                : inSelectedPath
                ? "rgba(34, 211, 238, 0.78)"
                : node.isActiveLeaf
                ? "#22d3ee"
                : node.isActiveBranch
                ? "rgba(34, 211, 238, 0.65)"
                : node.isExpandedSwipe
                ? "rgba(148, 163, 184, 0.38)"
                : node.isBranchTip
                ? "rgba(167, 139, 250, 0.65)"
                : "rgba(148, 163, 184, 0.28)";

              const fillColor = isInExpandedEpisode
                ? isSelected
                  ? "rgba(245, 158, 11, 0.24)"
                  : node.isActiveLeaf
                  ? "rgba(245, 158, 11, 0.18)"
                  : "rgba(38, 28, 16, 0.94)"
                : isSelected
                ? "rgba(14, 116, 144, 0.28)"
                : node.isActiveLeaf
                ? "rgba(14, 116, 144, 0.22)"
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
                if (node.kind === "episode" && node.episodeGroup) {
                  toggleEpisodeExpanded(node.episodeGroup.id, true);
                  return;
                }
                if (!node.isActiveBranch && node.isBranchTip && !isMutatingLocked) {
                  void handleTriggerSwitchTimeline(node.id);
                }
              };

              // Summary Pseudo-Node (Collapsed Summarized Episode)
              if (node.kind === "episode" && node.episodeGroup) {
                const ep = node.episodeGroup;
                const { index: variantIdx, variant } = getActiveVariant(ep);
                const hasMultipleVariants = ep.summaryVariants.length > 1;
                const rangeStr = formatEpisodeRange(ep);
                const titleLine = truncateInline(variant.title, 31);
                const synopsisLines = clampLines(variant.synopsis, 35, 2);

                const epBadgeText = node.isActiveLeaf
                  ? "ACTIVE"
                  : variant.kind === "in_progress"
                  ? "IN PROGRESS"
                  : variant.kind === "alternate"
                  ? "ALT"
                  : "SUMMARY";
                const epBadgeColor = node.isActiveLeaf
                  ? "#f59e0b"
                  : variant.kind === "in_progress"
                  ? "#94a3b8"
                  : variant.kind === "alternate"
                  ? "#a78bfa"
                  : "#fbbf24";

                const switcherText =
                  variant.kind === "in_progress"
                    ? `Alt summary (${ep.summaryVariants.length - 1})`
                    : variant.kind === "active"
                    ? `Active · 1/${ep.summaryVariants.length}`
                    : `Alt ${variantIdx}/${ep.summaryVariants.length - 1}`;

                const expandPillLabel = `+${ep.turnIds.length} ${
                  ep.turnIds.length === 1 ? "turn" : "turns"
                }`;
                const expandPillW = Math.max(66, expandPillLabel.length * 6.2 + 16);

                const epBadgeWidth = epBadgeText.length * 6 + 10;
                const epBadgeX = node.width - (epBadgeWidth + 10);
                const epBookmarkPillWidth =
                  ep.bookmarkCount > 0 ? 18 + String(ep.bookmarkCount).length * 6 : 0;

                return (
                  <g
                    key={node.id}
                    data-graph-interactive="true"
                    data-graph-node-id={node.id}
                    data-graph-node-kind="episode"
                    data-episode-id={ep.id}
                    data-episode-bookmarks={ep.bookmarkCount > 0 ? ep.bookmarkCount : undefined}
                    transform={`translate(${node.x}, ${topY})`}
                    style={{ cursor: "pointer" }}
                    onClick={handleNodeClick}
                    onDoubleClick={handleNodeDoubleClick}
                  >
                    {/* Stacked card backing layers to distinguish episode groups from single turns */}
                    <rect
                      x={5}
                      y={5}
                      width={node.width}
                      height={node.height}
                      rx={10}
                      fill="rgba(15, 23, 42, 0.55)"
                      stroke={strokeColor}
                      strokeWidth={0.9}
                      opacity={0.45}
                    />
                    <rect
                      x={0}
                      y={0}
                      width={node.width}
                      height={node.height}
                      rx={10}
                      fill={
                        isSelected
                          ? "rgba(14, 116, 144, 0.3)"
                          : variant.kind === "in_progress"
                          ? "rgba(30, 41, 59, 0.92)"
                          : node.isActiveBranch
                          ? "rgba(38, 32, 22, 0.94)"
                          : "rgba(24, 24, 44, 0.92)"
                      }
                      stroke={strokeColor}
                      strokeWidth={isSelected ? 2.4 : node.isActiveLeaf ? 2.1 : 1.5}
                    />

                    {/* Top Row: Range + Badge */}
                    <text
                      x={12}
                      y={19}
                      fill={
                        isSelected
                          ? "#67e8f9"
                          : variant.kind === "in_progress"
                          ? "#cbd5e1"
                          : "#fbbf24"
                      }
                      fontSize="11"
                      fontWeight="700"
                    >
                      {rangeStr}
                    </text>

                    {ep.bookmarkCount > 0 && (
                      <g
                        transform={`translate(${epBadgeX - epBookmarkPillWidth - 5}, 8)`}
                        data-episode-bookmark-badge={ep.id}
                      >
                        <rect
                          x={0}
                          y={0}
                          width={epBookmarkPillWidth}
                          height={15}
                          rx={4}
                          fill="rgba(88, 28, 135, 0.55)"
                          stroke="rgba(192, 132, 252, 0.85)"
                          strokeWidth={0.9}
                        />
                        <path
                          d="M5 3.2h5.5a.6.6 0 0 1 .6.6v7.7L7.75 9.6 4.4 11.5V3.8a.6.6 0 0 1 .6-.6z"
                          fill="#c084fc"
                          stroke="#f3e8ff"
                          strokeWidth={0.6}
                        />
                        <text
                          x={14}
                          y={10.5}
                          fill="#f3e8ff"
                          fontSize="8.5"
                          fontWeight="700"
                        >
                          {ep.bookmarkCount}
                        </text>
                        <title>{`Contains ${ep.bookmarkCount} bookmarked ${
                          ep.bookmarkCount === 1 ? "turn" : "turns"
                        }`}</title>
                      </g>
                    )}

                    <g transform={`translate(${epBadgeX}, 8)`}>
                      <rect
                        x={0}
                        y={0}
                        width={epBadgeWidth}
                        height={15}
                        rx={4}
                        fill="rgba(15, 23, 42, 0.78)"
                        stroke={epBadgeColor}
                        strokeWidth={0.9}
                      />
                      <text
                        x={5}
                        y={10.5}
                        fill={epBadgeColor}
                        fontSize="8.2"
                        fontWeight="700"
                        letterSpacing="0.04em"
                      >
                        {epBadgeText}
                      </text>
                    </g>

                    {/* Title Row */}
                    <text
                      x={12}
                      y={37}
                      fill={
                        variant.kind === "in_progress"
                          ? "#e2e8f0"
                          : variant.kind === "alternate"
                          ? "#ddd6fe"
                          : "#fde68a"
                      }
                      fontSize="11.2"
                      fontWeight="700"
                    >
                      {titleLine}
                    </text>

                    {/* Synopsis Lines */}
                    {synopsisLines.map((line, lineIdx) => (
                      <text
                        key={lineIdx}
                        x={12}
                        y={53 + lineIdx * 13.5}
                        fill={variant.kind === "in_progress" ? "#94a3b8" : "#cbd5e1"}
                        fontSize="10"
                        fontWeight="400"
                      >
                        {line}
                      </text>
                    ))}

                    {/* Bottom-Left: Inline Alternate-Summary Chevron Switcher */}
                    {hasMultipleVariants && (
                      <g
                        data-graph-interactive="true"
                        data-episode-variant-switcher={ep.id}
                        transform={`translate(8, ${node.height - 13})`}
                      >
                        <rect
                          x={0}
                          y={0}
                          width={142}
                          height={20}
                          rx={10}
                          fill="rgba(15, 23, 42, 0.96)"
                          stroke="rgba(167, 139, 250, 0.55)"
                          strokeWidth={1}
                        />
                        {/* Prev Chevron */}
                        <g
                          data-graph-interactive="true"
                          data-episode-variant-prev={ep.id}
                          style={{ cursor: "pointer" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            stepEpisodeVariant(ep.id, -1);
                          }}
                          onDoubleClick={(e) => e.stopPropagation()}
                        >
                          <rect x={-4} y={-4} width={24} height={28} fill="transparent" />
                          <text
                            x={10}
                            y={13.5}
                            textAnchor="middle"
                            fill="#c4b5fd"
                            fontSize="12"
                            fontWeight="700"
                          >
                            ‹
                          </text>
                          <title>View previous timeline summary</title>
                        </g>
                        {/* Center Label (cycles forward on click too) */}
                        <g
                          data-graph-interactive="true"
                          style={{ cursor: "pointer" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            stepEpisodeVariant(ep.id, 1);
                          }}
                          onDoubleClick={(e) => e.stopPropagation()}
                        >
                          <rect x={20} y={-2} width={102} height={24} fill="transparent" />
                          <text
                            x={71}
                            y={13}
                            textAnchor="middle"
                            fill="#ddd6fe"
                            fontSize="8.8"
                            fontWeight="600"
                          >
                            {truncateInline(switcherText, 18)}
                          </text>
                          <title>View alternate timeline summary</title>
                        </g>
                        {/* Next Chevron */}
                        <g
                          data-graph-interactive="true"
                          data-episode-variant-next={ep.id}
                          style={{ cursor: "pointer" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            stepEpisodeVariant(ep.id, 1);
                          }}
                          onDoubleClick={(e) => e.stopPropagation()}
                        >
                          <rect x={122} y={-4} width={24} height={28} fill="transparent" />
                          <text
                            x={132}
                            y={13.5}
                            textAnchor="middle"
                            fill="#c4b5fd"
                            fontSize="12"
                            fontWeight="700"
                          >
                            ›
                          </text>
                          <title>View alternate timeline summary</title>
                        </g>
                      </g>
                    )}

                    {/* Bottom-Right: Dedicated Expand Pill */}
                    <g
                      data-graph-interactive="true"
                      data-episode-expand-id={ep.id}
                      transform={`translate(${node.width - expandPillW - 6}, ${node.height - 13})`}
                      style={{ cursor: "pointer" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleEpisodeExpanded(ep.id, true);
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                      <rect
                        x={-6}
                        y={-6}
                        width={expandPillW + 12}
                        height={32}
                        fill="transparent"
                      />
                      <rect
                        x={0}
                        y={0}
                        width={expandPillW}
                        height={20}
                        rx={10}
                        fill="rgba(30, 41, 59, 0.98)"
                        stroke="#22d3ee"
                        strokeWidth={1.05}
                      />
                      <text
                        x={expandPillW / 2}
                        y={13.2}
                        textAnchor="middle"
                        fill="#67e8f9"
                        fontSize="9.2"
                        fontWeight="700"
                      >
                        {expandPillLabel}
                      </text>
                      <title>
                        {`Expand ${ep.turnIds.length} grouped ${
                          ep.turnIds.length === 1 ? "node" : "nodes"
                        }${
                          ep.hiddenSwipeCount > 0
                            ? ` (${ep.hiddenSwipeCount} hidden ${
                                ep.hiddenSwipeCount === 1 ? "swipe" : "swipes"
                              } inside)`
                            : ""
                        }`}
                      </title>
                    </g>
                  </g>
                );
              }

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
              const descPrefix = node.descriptionSource === "notable_event" ? "★ " : "";
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
              const turnLabel = `Turn #${node.depth}`;
              const turnLabelX = node.isBookmarked ? 24 : 12;
              const statusBadgeX =
                turnLabelX + Math.max(54, turnLabel.length * 6.8 + 8);

              return (
                <g
                  key={node.id}
                  data-graph-interactive="true"
                  data-graph-node-id={node.id}
                  data-graph-node-kind={node.kind}
                  data-bookmarked={node.isBookmarked ? "true" : undefined}
                  data-in-expanded-episode={isInExpandedEpisode ? "true" : undefined}
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

                  {/* Bookmark Indicator (Top-Left of Node Header) */}
                  {node.isBookmarked && (
                    <g transform="translate(10, 9)" data-node-bookmark-icon={node.id}>
                      <path
                        d="M1.5 1h6.5a.9.9 0 0 1 .9.9v9.6l-4.15-2.4L.6 11.5V1.9A.9.9 0 0 1 1.5 1z"
                        fill="#a855f7"
                        stroke="#f3e8ff"
                        strokeWidth={0.9}
                      />
                      <title>Bookmarked turn</title>
                    </g>
                  )}

                  {/* Top Row: Turn #N, Badge, Time */}
                  <text
                    x={turnLabelX}
                    y={20}
                    fill={
                      isInExpandedEpisode
                        ? isSelected
                          ? "#fde68a"
                          : "#fbbf24"
                        : isSelected
                        ? "#67e8f9"
                        : node.isActiveLeaf
                        ? "#67e8f9"
                        : node.isActiveBranch
                        ? "#f8fafc"
                        : "#cbd5e1"
                    }
                    fontSize="11.5"
                    fontWeight="700"
                  >
                    {turnLabel}
                  </text>

                  {badgeText && (
                    <g transform={`translate(${statusBadgeX}, 9)`}>
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

                  {/* Description lines (User Bookmark Note, Notable Summary, or Prompt Fallback) */}
                  {descLines.map((line, lineIdx) => (
                    <text
                      key={lineIdx}
                      x={12}
                      y={39 + lineIdx * 15}
                      fill={
                        node.descriptionSource === "user_note"
                          ? "#d8b4fe"
                          : node.descriptionSource === "notable_event"
                          ? "#fde68a"
                          : node.isExpandedSwipe
                          ? "#94a3b8"
                          : "#cbd5e1"
                      }
                      fontSize="10.8"
                      fontWeight={node.descriptionSource !== "fallback" ? "600" : "400"}
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
      {selectedNode && selectedEpisodeGroup && selectedEpisodeVariantInfo ? (
        <div
          className="branch-graph-detail-bar"
          data-selected-episode-id={selectedEpisodeGroup.id}
        >
          <div className="branch-graph-detail-info">
            <div className="branch-graph-detail-head">
              <strong className="branch-graph-detail-turn">
                Episode {selectedEpisodeGroup.episodeIndex} ·{" "}
                {formatEpisodeRange(selectedEpisodeGroup)}
              </strong>
              <span
                className={`branch-graph-status-pill ${
                  selectedNode.isActiveLeaf
                    ? "status-active-leaf"
                    : selectedEpisodeVariantInfo.variant.kind === "in_progress"
                    ? "status-in-progress"
                    : selectedEpisodeVariantInfo.variant.kind === "alternate"
                    ? "status-tip"
                    : "status-episode"
                }`}
              >
                {selectedNode.isActiveLeaf
                  ? "Contains Active Tip"
                  : selectedEpisodeVariantInfo.variant.kind === "in_progress"
                  ? "Episode in Progress"
                  : selectedEpisodeVariantInfo.variant.kind === "alternate"
                  ? "Alternate Timeline Summary"
                  : "Summarized Episode"}
              </span>
              <span className="branch-graph-detail-meta">
                {selectedEpisodeGroup.narrativeTurnCount}{" "}
                {selectedEpisodeGroup.narrativeTurnCount === 1 ? "turn" : "turns"}
                {selectedEpisodeGroup.waypointCount > 0 &&
                  ` + ${selectedEpisodeGroup.waypointCount} map ${
                    selectedEpisodeGroup.waypointCount === 1 ? "move" : "moves"
                  }`}
              </span>
              {selectedEpisodeGroup.outgoingBranchCount > 1 && (
                <span className="branch-graph-detail-meta">
                  <GitBranch size={11} />
                  {selectedEpisodeGroup.outgoingBranchCount} outgoing timelines
                </span>
              )}
              {selectedEpisodeGroup.hiddenSwipeCount > 0 && (
                <span className="branch-graph-detail-meta">
                  <Layers size={11} />
                  {selectedEpisodeGroup.hiddenSwipeCount} unfollowed{" "}
                  {selectedEpisodeGroup.hiddenSwipeCount === 1 ? "swipe" : "swipes"} inside
                </span>
              )}
              {selectedEpisodeGroup.bookmarkCount > 0 && (
                <span className="branch-graph-bookmark-pill">
                  <Bookmark size={11} fill="currentColor" />
                  {selectedEpisodeGroup.bookmarkCount} bookmarked
                </span>
              )}
            </div>

            {selectedEpisodeGroup.summaryVariants.length > 1 && (
              <div className="branch-graph-variant-switcher">
                <button
                  type="button"
                  className="btn btn-ghost branch-graph-icon-btn"
                  onClick={() => stepEpisodeVariant(selectedEpisodeGroup.id, -1)}
                  aria-label="View previous timeline summary"
                  title="View previous timeline summary"
                >
                  <ChevronLeft size={13} />
                </button>
                <span className="branch-graph-variant-label">
                  {selectedEpisodeVariantInfo.variant.kind === "in_progress"
                    ? `Active timeline: Episode in Progress (${
                        selectedEpisodeGroup.summaryVariants.length - 1
                      } alternate ${
                        selectedEpisodeGroup.summaryVariants.length - 1 === 1
                          ? "summary"
                          : "summaries"
                      } available)`
                    : selectedEpisodeVariantInfo.variant.kind === "active"
                    ? `Active Timeline Summary (1 / ${selectedEpisodeGroup.summaryVariants.length})`
                    : `${
                        selectedEpisodeVariantInfo.variant.sourceLabel ?? "Alternate timeline"
                      } (${selectedEpisodeVariantInfo.index + 1} / ${
                        selectedEpisodeGroup.summaryVariants.length
                      })`}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost branch-graph-icon-btn"
                  onClick={() => stepEpisodeVariant(selectedEpisodeGroup.id, 1)}
                  aria-label="View alternate timeline summary"
                  title="View alternate timeline summary"
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            )}

            <div className="branch-graph-detail-summary">
              {selectedEpisodeVariantInfo.variant.title}
            </div>

            {selectedEpisodeVariantInfo.variant.summaryText && (
              <div className="branch-graph-detail-prose">
                {selectedEpisodeVariantInfo.variant.summaryText}
              </div>
            )}
          </div>

          <div className="branch-graph-detail-actions">
            <button
              type="button"
              className="btn btn-cyan"
              onClick={() => toggleEpisodeExpanded(selectedEpisodeGroup.id, true)}
              title="Expand this episode to inspect individual turns, zoom, or branch"
            >
              <ScrollText size={13} />
              <span>
                Expand {selectedEpisodeGroup.turnIds.length}{" "}
                {selectedEpisodeGroup.turnIds.length === 1 ? "turn" : "turns"}
              </span>
            </button>

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
          </div>
        </div>
      ) : selectedNode ? (
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
              {selectedNode.isBookmarked && (
                <span className="branch-graph-bookmark-pill">
                  <Bookmark size={10} fill="currentColor" />
                  Bookmarked
                </span>
              )}
            </div>

            {selectedNode.turn.post_turn?.notable_event_summary?.trim() && (
              <div className="branch-graph-detail-summary">
                ★ {selectedNode.turn.post_turn.notable_event_summary.trim()}
              </div>
            )}

            {selectedNode.hasUserNote && selectedNode.turn.user_note?.trim() && (
              <div className="branch-graph-detail-bookmark-note">
                <Bookmark size={12} fill="currentColor" style={{ flexShrink: 0 }} />
                <span>{selectedNode.turn.user_note.trim()}</span>
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

            {/* Collapse parent episode when viewing an expanded member turn */}
            {selectedNode.memberEpisodeId && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => toggleEpisodeExpanded(selectedNode.memberEpisodeId!, false)}
                title="Collapse this summarized episode back into a summary node"
              >
                <Minimize2 size={13} />
                <span>Collapse Episode</span>
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
      ) : null}
    </div>
  );
};
