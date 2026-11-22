import type { EpisodicChunkRecord, TurnNodeRecord } from "../../types";

export const TURN_CARD_W = 228;
export const TURN_CARD_H = 76;
export const WAYPOINT_W = 152;
export const WAYPOINT_H = 38;
export const SWIPE_CARD_W = 192;
export const SWIPE_CARD_H = 56;
export const COL_GAP = 56;
export const ROW_GAP = 22;
export const MIN_GRAPH_ZOOM = 0.25;
export const MAX_GRAPH_ZOOM = 2.0;

export type BranchGraphNodeKind = "opening" | "standard" | "waypoint" | "swipe";

export interface BranchGraphNode {
  id: string;
  turn: TurnNodeRecord;
  parentId: string | null;
  depth: number;
  kind: BranchGraphNodeKind;
  isActiveBranch: boolean;
  isActiveLeaf: boolean;
  /** True when the node has 0 visible non-swipe children (or is an expanded unfollowed swipe). */
  isBranchTip: boolean;
  /**
   * For nodes NOT on the active branch:
   * - equals `id` if the node itself is a branch tip (or expanded unfollowed swipe),
   * - equals the sole visible descendant branch tip if the subtree has exactly 1 tip,
   * - `null` if on the active branch or if an alternate interior node splits into 2+ tips.
   */
  uniqueDescendantTipId: string | null;
  /** Hidden unfollowed same-prompt sibling swipes anchored to this node. */
  hiddenSwipes: TurnNodeRecord[];
  /** True when rendered via per-node swipe expansion or global show-all-swipes. */
  isExpandedSwipe: boolean;
  /** Anchor node ID when `isExpandedSwipe` is true. */
  swipeAnchorId: string | null;
  /** Non-null when an episodic summary chunk ends at this turn (`chunk.leaf_turn_id === turn.id`). */
  episodicChunkLabel: string | null;
  /** Primary display text: `notable_event_summary` when present, else prompt/opening/location fallback. */
  description: string;
  hasNotableSummary: boolean;
  locationName: string;
  /** Left X coordinate in SVG graph space. */
  x: number;
  /** Vertical center Y coordinate in SVG graph space. */
  y: number;
  width: number;
  height: number;
}

export interface BranchGraphEdge {
  id: string;
  fromId: string;
  toId: string;
  isActiveBranch: boolean;
  isExpandedSwipe: boolean;
}

export interface BranchGraphBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

export interface BranchGraphModel {
  nodes: BranchGraphNode[];
  nodeById: Record<string, BranchGraphNode>;
  edges: BranchGraphEdge[];
  totalHiddenSwipes: number;
  branchTipCount: number;
  bounds: BranchGraphBounds;
}

export interface BuildBranchGraphParams {
  allTurns: TurnNodeRecord[];
  activeBranchTurns: TurnNodeRecord[];
  activeLeafId?: string | null;
  episodicChunks?: EpisodicChunkRecord[];
  locationNamesById?: Record<string, string>;
  expandedSwipeAnchorIds?: ReadonlySet<string>;
  showAllSwipes?: boolean;
}

export function clampGraphZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_GRAPH_ZOOM, Math.max(MIN_GRAPH_ZOOM, zoom));
}

function resolveTurnLocationName(
  turn: TurnNodeRecord,
  locationNamesById: Record<string, string>
): string {
  const locId = turn.world_snapshot?.active_location_id;
  if (locId && locationNamesById[locId]) {
    return locationNamesById[locId];
  }
  const cards = turn.post_turn?.first_visit_cards;
  if (cards && cards.length > 0) {
    const locCard = cards.find((c) => c.entity_type === "location") ?? cards[cards.length - 1];
    if (locCard?.title) {
      return locCard.title;
    }
  }
  return locId || "Unknown Location";
}

function resolveNodeDescription(
  turn: TurnNodeRecord,
  locationName: string
): { description: string; hasNotableSummary: boolean } {
  const summary = turn.post_turn?.notable_event_summary?.trim();
  if (summary) {
    return { description: summary, hasNotableSummary: true };
  }
  if (turn.depth_index === 0) {
    return { description: "[Opening Scene]", hasNotableSummary: false };
  }
  if (turn.actor_id === "__arrival__") {
    return {
      description: locationName ? `Arrived: ${locationName}` : "Map Move",
      hasNotableSummary: false,
    };
  }
  const msg = (turn.user_message || "").trim();
  if (msg) {
    return { description: msg, hasNotableSummary: false };
  }
  if (turn.actor_id === "__narrator__") {
    return { description: "[Scene Narration]", hasNotableSummary: false };
  }
  return { description: `Turn #${turn.depth_index}`, hasNotableSummary: false };
}

function getNodeDimensions(kind: BranchGraphNodeKind): { width: number; height: number } {
  if (kind === "waypoint") {
    return { width: WAYPOINT_W, height: WAYPOINT_H };
  }
  if (kind === "swipe") {
    return { width: SWIPE_CARD_W, height: SWIPE_CARD_H };
  }
  return { width: TURN_CARD_W, height: TURN_CARD_H };
}

/**
 * Build a deterministic, pan/zoom-ready SVG branch tree from campaign turn nodes.
 *
 * Implements the zero-migration same-`user_message` swipe hiding rule:
 * - Every node on `activeBranchTurns` is always visible.
 * - Every node with at least 1 child is always visible.
 * - Childless non-active siblings sharing `parent_turn_id` + `user_message` with a visible
 *   sibling are visually collapsed into that sibling's `hiddenSwipes` (expandable on click).
 * - Distinct-prompt childless alternate branches stay visible (never hidden by swipe filtering).
 */
export function buildBranchGraphModel({
  allTurns,
  activeBranchTurns,
  activeLeafId,
  episodicChunks = [],
  locationNamesById = {},
  expandedSwipeAnchorIds = new Set<string>(),
  showAllSwipes = false,
}: BuildBranchGraphParams): BranchGraphModel {
  if (!allTurns || allTurns.length === 0) {
    return {
      nodes: [],
      nodeById: {},
      edges: [],
      totalHiddenSwipes: 0,
      branchTipCount: 0,
      bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 },
    };
  }

  const turnById = new Map<string, TurnNodeRecord>();
  for (const t of allTurns) {
    turnById.set(t.id, t);
  }

  const activeBranchSet = new Set(activeBranchTurns.map((t) => t.id));
  const effectiveActiveLeafId =
    activeLeafId ??
    activeBranchTurns[activeBranchTurns.length - 1]?.id ??
    null;

  const chunkLabelByTurnId = new Map<string, string>();
  for (const chunk of episodicChunks) {
    chunkLabelByTurnId.set(
      chunk.leaf_turn_id,
      `Turns ${chunk.start_turn_depth}–${chunk.end_turn_depth}`
    );
  }

  // 1. Raw parent -> children mapping preserving creation order
  const rawChildrenByParent = new Map<string | null, TurnNodeRecord[]>();
  for (const t of allTurns) {
    const parentKey =
      t.parent_turn_id && turnById.has(t.parent_turn_id) ? t.parent_turn_id : null;
    let bucket = rawChildrenByParent.get(parentKey);
    if (!bucket) {
      bucket = [];
      rawChildrenByParent.set(parentKey, bucket);
    }
    bucket.push(t);
  }

  // 2. Apply zero-migration same-user_message unfollowed swipe collapsing per parent
  const visibleChildrenByParent = new Map<string | null, TurnNodeRecord[]>();
  const hiddenSwipesByAnchorId = new Map<string, TurnNodeRecord[]>();
  let totalHiddenSwipes = 0;

  for (const [parentKey, rawChildren] of rawChildrenByParent.entries()) {
    const primary: TurnNodeRecord[] = [];
    const childlessInactive: TurnNodeRecord[] = [];

    for (const child of rawChildren) {
      const hasKids = (rawChildrenByParent.get(child.id)?.length ?? 0) > 0;
      if (activeBranchSet.has(child.id) || hasKids) {
        primary.push(child);
      } else {
        childlessInactive.push(child);
      }
    }

    // Group remaining childless non-active siblings by user_message
    const promptOrder: string[] = [];
    const promptGroups = new Map<string, TurnNodeRecord[]>();
    for (const child of childlessInactive) {
      const key = child.user_message;
      let grp = promptGroups.get(key);
      if (!grp) {
        grp = [];
        promptGroups.set(key, grp);
        promptOrder.push(key);
      }
      grp.push(child);
    }

    const visibleForParent: TurnNodeRecord[] = [...primary];

    for (const promptKey of promptOrder) {
      const group = promptGroups.get(promptKey) ?? [];
      if (group.length === 0) continue;

      // Prefer anchoring to an active-branch primary sibling with matching prompt,
      // otherwise the first followed primary sibling with matching prompt.
      const activePrimaryMatch = primary.find(
        (p) => p.user_message === promptKey && activeBranchSet.has(p.id)
      );
      const anyPrimaryMatch =
        activePrimaryMatch ?? primary.find((p) => p.user_message === promptKey);

      if (anyPrimaryMatch) {
        const existing = hiddenSwipesByAnchorId.get(anyPrimaryMatch.id) ?? [];
        hiddenSwipesByAnchorId.set(anyPrimaryMatch.id, [...existing, ...group]);
        totalHiddenSwipes += group.length;
      } else {
        // Distinct-prompt 1-turn alternate branch: keep newest turn visible, collapse older same-prompt swipes
        const anchor = group[group.length - 1];
        visibleForParent.push(anchor);
        if (group.length > 1) {
          const olderSwipes = group.slice(0, -1);
          hiddenSwipesByAnchorId.set(anchor.id, olderSwipes);
          totalHiddenSwipes += olderSwipes.length;
        }
      }
    }

    // Order: active-branch child first (keeps active spine straight), then chronological order
    const originalIndex = new Map(rawChildren.map((c, idx) => [c.id, idx]));
    visibleForParent.sort((a, b) => {
      const aActive = activeBranchSet.has(a.id) ? 0 : 1;
      const bActive = activeBranchSet.has(b.id) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0);
    });

    visibleChildrenByParent.set(parentKey, visibleForParent);
  }

  // 3. Compute reachable visible non-swipe branch tips bottom-up
  const reachableTipsById = new Map<string, string[]>();
  const computeTips = (nodeId: string, stack: Set<string>): string[] => {
    const cached = reachableTipsById.get(nodeId);
    if (cached) return cached;
    if (stack.has(nodeId)) return [];
    stack.add(nodeId);

    const children = visibleChildrenByParent.get(nodeId) ?? [];
    let tips: string[];
    if (children.length === 0) {
      tips = [nodeId];
    } else {
      const acc: string[] = [];
      for (const child of children) {
        for (const tipId of computeTips(child.id, stack)) {
          if (!acc.includes(tipId)) acc.push(tipId);
        }
      }
      tips = acc;
    }

    stack.delete(nodeId);
    reachableTipsById.set(nodeId, tips);
    return tips;
  };

  const rootTurns = visibleChildrenByParent.get(null) ?? [];
  for (const r of rootTurns) {
    computeTips(r.id, new Set());
  }

  // 4. Deterministic primary-spine horizontal tree layout + optional inline swipe expansion
  const nodes: BranchGraphNode[] = [];
  const nodeById: Record<string, BranchGraphNode> = {};
  const edges: BranchGraphEdge[] = [];
  const visitedLayout = new Set<string>();
  let nextY = 0;

  const createGraphNode = (
    turn: TurnNodeRecord,
    parentId: string | null,
    x: number,
    isExpandedSwipe: boolean,
    swipeAnchorId: string | null
  ): BranchGraphNode => {
    const isActiveBranch = !isExpandedSwipe && activeBranchSet.has(turn.id);
    const isActiveLeaf = !isExpandedSwipe && turn.id === effectiveActiveLeafId;
    const visibleKids = isExpandedSwipe ? [] : visibleChildrenByParent.get(turn.id) ?? [];
    const isBranchTip = isExpandedSwipe || visibleKids.length === 0;
    const tips = isExpandedSwipe ? [turn.id] : reachableTipsById.get(turn.id) ?? [turn.id];
    const uniqueDescendantTipId = isExpandedSwipe
      ? turn.id
      : !isActiveBranch && tips.length === 1
      ? tips[0]
      : null;

    const kind: BranchGraphNodeKind = isExpandedSwipe
      ? "swipe"
      : turn.actor_id === "__arrival__"
      ? "waypoint"
      : turn.depth_index === 0
      ? "opening"
      : "standard";

    const { width, height } = getNodeDimensions(kind);
    const locationName = resolveTurnLocationName(turn, locationNamesById);
    const { description, hasNotableSummary } = resolveNodeDescription(turn, locationName);
    const hiddenSwipes = isExpandedSwipe ? [] : hiddenSwipesByAnchorId.get(turn.id) ?? [];

    return {
      id: turn.id,
      turn,
      parentId,
      depth: turn.depth_index,
      kind,
      isActiveBranch,
      isActiveLeaf,
      isBranchTip,
      uniqueDescendantTipId,
      hiddenSwipes,
      isExpandedSwipe,
      swipeAnchorId,
      episodicChunkLabel: chunkLabelByTurnId.get(turn.id) ?? null,
      description,
      hasNotableSummary,
      locationName,
      x,
      y: 0,
      width,
      height,
    };
  };

  const layoutSubtree = (
    turn: TurnNodeRecord,
    parentId: string | null,
    x: number
  ): BranchGraphNode | null => {
    if (visitedLayout.has(turn.id)) return null;
    visitedLayout.add(turn.id);

    const node = createGraphNode(turn, parentId, x, false, null);
    nodes.push(node);
    nodeById[node.id] = node;

    if (parentId !== null) {
      edges.push({
        id: `${parentId}->${node.id}`,
        fromId: parentId,
        toId: node.id,
        isActiveBranch: activeBranchSet.has(parentId) && activeBranchSet.has(node.id),
        isExpandedSwipe: false,
      });
    }

    const visibleKids = visibleChildrenByParent.get(turn.id) ?? [];
    const childX = x + node.width + COL_GAP;
    let firstChildNode: BranchGraphNode | null = null;

    if (visibleKids.length === 0) {
      const bandH = Math.max(node.height, TURN_CARD_H);
      node.y = nextY + bandH / 2;
      nextY += bandH + ROW_GAP;
    } else {
      for (const childTurn of visibleKids) {
        const childNode = layoutSubtree(childTurn, node.id, childX);
        if (!firstChildNode && childNode) {
          firstChildNode = childNode;
        }
      }
      if (firstChildNode) {
        node.y = firstChildNode.y;
      } else {
        const bandH = Math.max(node.height, TURN_CARD_H);
        node.y = nextY + bandH / 2;
        nextY += bandH + ROW_GAP;
      }
    }

    // If this node has hidden unfollowed swipes AND is expanded, place them directly below this subtree
    const hiddenSwipes = hiddenSwipesByAnchorId.get(turn.id) ?? [];
    if (hiddenSwipes.length > 0 && (showAllSwipes || expandedSwipeAnchorIds.has(turn.id))) {
      for (const swipeTurn of hiddenSwipes) {
        if (visitedLayout.has(swipeTurn.id)) continue;
        visitedLayout.add(swipeTurn.id);
        const swipeNode = createGraphNode(swipeTurn, parentId, x, true, node.id);
        swipeNode.y = nextY + swipeNode.height / 2;
        nextY += swipeNode.height + ROW_GAP;
        nodes.push(swipeNode);
        nodeById[swipeNode.id] = swipeNode;
        if (parentId !== null) {
          edges.push({
            id: `${parentId}->${swipeNode.id}`,
            fromId: parentId,
            toId: swipeNode.id,
            isActiveBranch: false,
            isExpandedSwipe: true,
          });
        }
      }
    }

    return node;
  };

  for (const rootTurn of rootTurns) {
    layoutSubtree(rootTurn, null, 0);
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let branchTipCount = 0;

  for (const n of nodes) {
    if (!n.isExpandedSwipe && n.isBranchTip) {
      branchTipCount += 1;
    }
    const top = n.y - n.height / 2;
    const bottom = n.y + n.height / 2;
    if (n.x < minX) minX = n.x;
    if (n.x + n.width > maxX) maxX = n.x + n.width;
    if (top < minY) minY = top;
    if (bottom > maxY) maxY = bottom;
  }

  const bounds: BranchGraphBounds =
    nodes.length === 0
      ? { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 }
      : {
          minX,
          maxX,
          minY,
          maxY,
          width: Math.max(1, maxX - minX),
          height: Math.max(1, maxY - minY),
        };

  return {
    nodes,
    nodeById,
    edges,
    totalHiddenSwipes,
    branchTipCount,
    bounds,
  };
}

/**
 * Compute all ancestor node IDs and edge IDs along the unique path from Turn #0 to `targetNodeId`.
 */
export function computeAncestorPath(
  nodeById: Record<string, BranchGraphNode>,
  targetNodeId: string | null | undefined
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  if (!targetNodeId || !nodeById[targetNodeId]) {
    return { nodeIds, edgeIds };
  }

  let curr: BranchGraphNode | undefined = nodeById[targetNodeId];
  while (curr && !nodeIds.has(curr.id)) {
    nodeIds.add(curr.id);
    if (curr.parentId && nodeById[curr.parentId]) {
      edgeIds.add(`${curr.parentId}->${curr.id}`);
      curr = nodeById[curr.parentId];
    } else {
      break;
    }
  }

  return { nodeIds, edgeIds };
}

/**
 * Compute a pan/zoom transform that fits the entire graph cleanly inside the viewport.
 */
export function computeFitGraphViewport(
  bounds: BranchGraphBounds,
  viewportW: number,
  viewportH: number,
  padding = 48
): { zoom: number; pan: { x: number; y: number } } {
  if (bounds.width <= 0 || bounds.height <= 0 || viewportW <= 0 || viewportH <= 0) {
    return { zoom: 1, pan: { x: padding, y: padding } };
  }
  const availW = Math.max(80, viewportW - padding * 2);
  const availH = Math.max(80, viewportH - padding * 2);
  const rawZoom = Math.min(availW / bounds.width, availH / bounds.height, 1.05);
  const zoom = clampGraphZoom(rawZoom);
  const panX = (viewportW - bounds.width * zoom) / 2 - bounds.minX * zoom;
  const panY = (viewportH - bounds.height * zoom) / 2 - bounds.minY * zoom;
  return { zoom, pan: { x: panX, y: panY } };
}

/**
 * Compute a pan transform that centers a target node inside the viewport at the requested zoom.
 */
export function computeCenterNodeViewport(
  node: Pick<BranchGraphNode, "x" | "y" | "width">,
  viewportW: number,
  viewportH: number,
  zoom = 1
): { zoom: number; pan: { x: number; y: number } } {
  const clampedZoom = clampGraphZoom(zoom);
  const centerX = node.x + node.width / 2;
  const centerY = node.y;
  return {
    zoom: clampedZoom,
    pan: {
      x: viewportW / 2 - centerX * clampedZoom,
      y: viewportH / 2 - centerY * clampedZoom,
    },
  };
}

/**
 * Compute the cubic Bézier path string connecting parent right edge to child left edge.
 */
export function buildBranchEdgePath(
  fromNode: Pick<BranchGraphNode, "x" | "y" | "width">,
  toNode: Pick<BranchGraphNode, "x" | "y">
): string {
  const x1 = fromNode.x + fromNode.width;
  const y1 = fromNode.y;
  const x2 = toNode.x;
  const y2 = toNode.y;
  const dx = Math.max(24, (x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

/**
 * Lightweight count of visible timelines (branch tips) using the same swipe-hiding rules.
 */
export function countVisibleTimelines(
  allTurns: TurnNodeRecord[],
  activeBranchTurns: TurnNodeRecord[],
  activeLeafId?: string | null
): number {
  return buildBranchGraphModel({
    allTurns,
    activeBranchTurns,
    activeLeafId,
  }).branchTipCount;
}
