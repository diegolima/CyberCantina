import type { EpisodicChunkRecord, TurnNodeRecord } from "../../types";

export const TURN_CARD_W = 228;
export const TURN_CARD_H = 76;
export const WAYPOINT_W = 152;
export const WAYPOINT_H = 38;
export const SWIPE_CARD_W = 192;
export const SWIPE_CARD_H = 56;
export const EPISODE_CARD_W = 252;
export const EPISODE_CARD_H = 98;
export const COL_GAP = 56;
export const ROW_GAP = 22;
export const MIN_GRAPH_ZOOM = 0.25;
export const MAX_GRAPH_ZOOM = 2.0;

export type BranchGraphNodeKind = "opening" | "standard" | "waypoint" | "swipe" | "episode";

export interface EpisodeSummaryVariant {
  /**
   * - `"active"`: summary chunk belonging to the currently active timeline.
   * - `"in_progress"`: spoiler-safe placeholder when the episode intersects the active
   *   timeline, but the active timeline has not created a matching summary yet.
   * - `"alternate"`: summary chunk created on another timeline.
   */
  kind: "active" | "in_progress" | "alternate";
  chunkId: string | null;
  title: string;
  synopsis: string;
  summaryText: string;
  rangeLabel: string;
  /** Source hint for alternate summaries (e.g. "via Turn #17"). */
  sourceLabel: string | null;
  leafTurnId: string | null;
}

export interface EpisodeGroupMeta {
  /** Stable pseudo-node ID (e.g. `episode:<primaryChunkId>`). */
  id: string;
  /** 1-based ordinal index in layout order. */
  episodeIndex: number;
  primaryChunkId: string;
  startDepth: number;
  endDepth: number;
  /** Ordered root-to-leaf turn IDs grouped by this episode (including absorbed interior waypoints). */
  turnIds: string[];
  /** Number of non-waypoint turns inside `turnIds`. */
  narrativeTurnCount: number;
  /** Number of absorbed `__arrival__` waypoints inside `turnIds`. */
  waypointCount: number;
  /** True when at least one turn in `turnIds` lies on `activeBranchTurns`. */
  intersectsActiveBranch: boolean;
  /** True when `activeLeafId` is one of `turnIds`. */
  containsActiveLeaf: boolean;
  /** Aggregate hidden unfollowed swipes anchored to turns inside `turnIds`. */
  hiddenSwipeCount: number;
  /** Number of visible outgoing edges exiting this episode to turns outside `turnIds`. */
  outgoingBranchCount: number;
  /** Ordered summary variants (index 0 is default: active summary, "Episode in Progress", or alternate summary). */
  summaryVariants: EpisodeSummaryVariant[];
  /** True when index 0 is the `"Episode in Progress"` placeholder. */
  isInProgressOnActive: boolean;
}

export interface ExpandedEpisodeSegment {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ExpandedEpisodeFrame {
  episodeId: string;
  episode: EpisodeGroupMeta;
  /** Contiguous same-row bounding boxes enclosing member turns without overlapping foreign branches. */
  segments: ExpandedEpisodeSegment[];
  /** Anchor point for the Collapse pill (top-right of the primary segment). */
  headerX: number;
  headerY: number;
  headerWidth: number;
}

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
  /** Non-null when `kind === "episode"`. */
  episodeGroup: EpisodeGroupMeta | null;
  /** Non-null on normal/waypoint turns currently rendered inside an expanded episode. */
  memberEpisodeId: string | null;
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
  /** Real turn depth inside a collapsed episode from which this outgoing edge originated. */
  originTurnDepth: number | null;
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
  episodes: EpisodeGroupMeta[];
  episodeById: Record<string, EpisodeGroupMeta>;
  expandedEpisodeFrames: ExpandedEpisodeFrame[];
  /** Episodes that contain `activeLeafId` and should open pre-expanded by default. */
  defaultExpandedEpisodeIds: string[];
  totalTurnCount: number;
  collapsedEpisodeCount: number;
  totalHiddenSwipes: number;
  branchTipCount: number;
  bounds: BranchGraphBounds;
}

export interface BuildBranchGraphParams {
  allTurns: TurnNodeRecord[];
  activeBranchTurns: TurnNodeRecord[];
  activeLeafId?: string | null;
  /** Active-branch episodic chunks (from `bundle.episodic_chunks`). */
  episodicChunks?: EpisodicChunkRecord[];
  /** All campaign episodic chunks across every timeline (from `bundle.all_episodic_chunks`). */
  allEpisodicChunks?: EpisodicChunkRecord[];
  locationNamesById?: Record<string, string>;
  expandedSwipeAnchorIds?: ReadonlySet<string>;
  /**
   * Episode IDs currently expanded into individual turns.
   * When omitted (`undefined`), defaults to auto-expanding episodes containing `activeLeafId`,
   * modulated by `episodeExpandOverrides`.
   */
  expandedEpisodeIds?: ReadonlySet<string>;
  /**
   * Per-episode user expand/collapse overrides layered on top of `defaultExpandedEpisodeIds`
   * (active-tip auto-expansion). Ignored when `expandedEpisodeIds` is explicitly provided.
   */
  episodeExpandOverrides?: Record<string, boolean>;
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
  if (kind === "episode") {
    return { width: EPISODE_CARD_W, height: EPISODE_CARD_H };
  }
  if (kind === "waypoint") {
    return { width: WAYPOINT_W, height: WAYPOINT_H };
  }
  if (kind === "swipe") {
    return { width: SWIPE_CARD_W, height: SWIPE_CARD_H };
  }
  return { width: TURN_CARD_W, height: TURN_CARD_H };
}

function extractFirstSentence(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const dotIdx = clean.indexOf(". ");
  if (dotIdx > 0 && dotIdx < 200) {
    return clean.slice(0, dotIdx + 1);
  }
  return clean.length > 200 ? `${clean.slice(0, 199)}…` : clean;
}

function formatDepthRange(startDepth: number, endDepth: number): string {
  return startDepth === endDepth ? `Turn ${startDepth}` : `Turns ${startDepth}–${endDepth}`;
}

function buildChunkSummaryVariant(
  chunk: EpisodicChunkRecord,
  kind: "active" | "alternate",
  turnById: Map<string, TurnNodeRecord>
): EpisodeSummaryVariant {
  const rangeLabel = formatDepthRange(chunk.start_turn_depth, chunk.end_turn_depth);
  const title = (chunk.title || "").trim() || `Episode (${rangeLabel})`;
  const summaryText = (chunk.summary_text || "").trim();
  const synopsis =
    (chunk.synopsis_text || "").trim() || extractFirstSentence(summaryText) || rangeLabel;
  const leafTurn = turnById.get(chunk.leaf_turn_id);
  const sourceLabel =
    kind === "alternate"
      ? leafTurn
        ? `Alternate timeline (via Turn #${leafTurn.depth_index})`
        : "Alternate timeline"
      : null;

  return {
    kind,
    chunkId: chunk.id,
    title,
    synopsis,
    summaryText: summaryText || synopsis,
    rangeLabel,
    sourceLabel,
    leafTurnId: chunk.leaf_turn_id,
  };
}

function buildInProgressVariant(startDepth: number, endDepth: number): EpisodeSummaryVariant {
  const rangeLabel = formatDepthRange(startDepth, endDepth);
  return {
    kind: "in_progress",
    chunkId: null,
    title: "Episode in Progress",
    synopsis: `${rangeLabel} · Summarized on another timeline`,
    summaryText: `The active timeline has not created a summary for ${rangeLabel} yet. Use the alternate summary switcher to preview summaries from other timelines.`,
    rangeLabel,
    sourceLabel: null,
    leafTurnId: null,
  };
}

/**
 * Walk backward via `parent_turn_id` from `chunk.leaf_turn_id` to resolve the exact
 * root-to-leaf turn chain covered by `[chunk.start_turn_depth, chunk.end_turn_depth]`.
 * Interior `__arrival__` waypoints along that chain are naturally included; Turn #0 is excluded.
 */
function resolveChunkTurnChain(
  chunk: EpisodicChunkRecord,
  turnById: Map<string, TurnNodeRecord>,
  visibleTurnSet: Set<string>
): TurnNodeRecord[] {
  const startNode = turnById.get(chunk.leaf_turn_id);
  if (!startNode) return [];

  const collected: TurnNodeRecord[] = [];
  const seen = new Set<string>();
  let curr: TurnNodeRecord | undefined = startNode;

  while (curr && !seen.has(curr.id)) {
    seen.add(curr.id);
    if (
      curr.depth_index > 0 &&
      curr.depth_index >= chunk.start_turn_depth &&
      curr.depth_index <= chunk.end_turn_depth &&
      visibleTurnSet.has(curr.id)
    ) {
      collected.push(curr);
    }
    if (curr.depth_index <= chunk.start_turn_depth) {
      break;
    }
    curr = curr.parent_turn_id ? turnById.get(curr.parent_turn_id) : undefined;
  }

  collected.reverse();
  return collected;
}

/**
 * Build a deterministic, pan/zoom-ready SVG branch tree from campaign turn nodes,
 * collapsing summarized episodic spans into interactive Summary Pseudo-Nodes.
 *
 * Implements:
 * - Zero-migration same-`user_message` unfollowed swipe hiding.
 * - Cross-timeline exact turn-ID chain episode grouping with interior `__arrival__`
 *   waypoint absorption and active-first disjoint ownership precedence.
 * - Spoiler-safe `"Episode in Progress"` default + alternate-timeline summary variants.
 * - Single/multi-branch re-parenting onto collapsed pseudo-nodes with exact origin depths.
 * - Active-tip auto-expansion (`defaultExpandedEpisodeIds`).
 */
export function buildBranchGraphModel({
  allTurns,
  activeBranchTurns,
  activeLeafId,
  episodicChunks = [],
  allEpisodicChunks,
  locationNamesById = {},
  expandedSwipeAnchorIds = new Set<string>(),
  expandedEpisodeIds,
  episodeExpandOverrides,
  showAllSwipes = false,
}: BuildBranchGraphParams): BranchGraphModel {
  if (!allTurns || allTurns.length === 0) {
    return {
      nodes: [],
      nodeById: {},
      edges: [],
      episodes: [],
      episodeById: {},
      expandedEpisodeFrames: [],
      defaultExpandedEpisodeIds: [],
      totalTurnCount: 0,
      collapsedEpisodeCount: 0,
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
    activeLeafId ?? activeBranchTurns[activeBranchTurns.length - 1]?.id ?? null;

  const chunkLabelByTurnId = new Map<string, string>();
  for (const chunk of episodicChunks) {
    chunkLabelByTurnId.set(
      chunk.leaf_turn_id,
      formatDepthRange(chunk.start_turn_depth, chunk.end_turn_depth)
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
        const anchor = group[group.length - 1];
        visibleForParent.push(anchor);
        if (group.length > 1) {
          const olderSwipes = group.slice(0, -1);
          hiddenSwipesByAnchorId.set(anchor.id, olderSwipes);
          totalHiddenSwipes += olderSwipes.length;
        }
      }
    }

    const originalIndex = new Map(rawChildren.map((c, idx) => [c.id, idx]));
    visibleForParent.sort((a, b) => {
      const aActive = activeBranchSet.has(a.id) ? 0 : 1;
      const bActive = activeBranchSet.has(b.id) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0);
    });

    visibleChildrenByParent.set(parentKey, visibleForParent);
  }

  // 3. Walk underlying visible tree to compute invariant visibleTurnSet, totalTurnCount, and reachable tips
  const visibleTurnSet = new Set<string>();
  const reachableTipsById = new Map<string, string[]>();
  let underlyingBranchTipCount = 0;

  const computeTips = (nodeId: string, stack: Set<string>): string[] => {
    const cached = reachableTipsById.get(nodeId);
    if (cached) return cached;
    if (stack.has(nodeId)) return [];
    stack.add(nodeId);
    visibleTurnSet.add(nodeId);

    const children = visibleChildrenByParent.get(nodeId) ?? [];
    let tips: string[];
    if (children.length === 0) {
      tips = [nodeId];
      underlyingBranchTipCount += 1;
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
  const totalTurnCount = visibleTurnSet.size;

  // 4. Resolve cross-timeline summarized episodes with active-first disjoint turn ownership
  const activeChunkIdSet = new Set(episodicChunks.map((c) => c.id));
  const mergedChunksById = new Map<string, EpisodicChunkRecord>();
  for (const c of allEpisodicChunks ?? episodicChunks) {
    mergedChunksById.set(c.id, c);
  }
  for (const c of episodicChunks) {
    if (!mergedChunksById.has(c.id)) {
      mergedChunksById.set(c.id, c);
    }
  }

  const isActiveChunk = (c: EpisodicChunkRecord): boolean =>
    activeChunkIdSet.has(c.id) || activeBranchSet.has(c.leaf_turn_id);

  const sortedChunks = Array.from(mergedChunksById.values()).sort((a, b) => {
    const aActive = isActiveChunk(a) ? 0 : 1;
    const bActive = isActiveChunk(b) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    if (a.start_turn_depth !== b.start_turn_depth) {
      return a.start_turn_depth - b.start_turn_depth;
    }
    if (a.end_turn_depth !== b.end_turn_depth) {
      return a.end_turn_depth - b.end_turn_depth;
    }
    return a.created_at.localeCompare(b.created_at);
  });

  const claimedTurnIds = new Set<string>();
  const ownerEpisodeByTurnId = new Map<string, EpisodeGroupMeta>();
  const episodes: EpisodeGroupMeta[] = [];
  const episodeById: Record<string, EpisodeGroupMeta> = {};

  for (const chunk of sortedChunks) {
    const chain = resolveChunkTurnChain(chunk, turnById, visibleTurnSet);
    if (chain.length === 0) continue;

    const chunkIsActive = isActiveChunk(chunk);

    // Register overlapping alternate summary variants on already-claimed owner episodes
    const touchedOwners = new Set<EpisodeGroupMeta>();
    for (const t of chain) {
      const owner = ownerEpisodeByTurnId.get(t.id);
      if (owner) touchedOwners.add(owner);
    }
    for (const owner of touchedOwners) {
      if (
        !owner.summaryVariants.some((v) => v.chunkId === chunk.id) &&
        chunk.id !== owner.primaryChunkId
      ) {
        owner.summaryVariants.push(
          buildChunkSummaryVariant(chunk, chunkIsActive ? "active" : "alternate", turnById)
        );
      }
    }

    // Group remaining unclaimed turns into contiguous parent-linked runs
    const unclaimed = chain.filter((t) => !claimedTurnIds.has(t.id));
    if (unclaimed.length === 0) continue;

    const runs: TurnNodeRecord[][] = [];
    let currentRun: TurnNodeRecord[] = [];
    for (const t of unclaimed) {
      if (
        currentRun.length === 0 ||
        t.parent_turn_id === currentRun[currentRun.length - 1].id
      ) {
        currentRun.push(t);
      } else {
        runs.push(currentRun);
        currentRun = [t];
      }
    }
    if (currentRun.length > 0) {
      runs.push(currentRun);
    }

    runs.forEach((run, runIdx) => {
      if (run.length === 0) return;
      const epId = runIdx === 0 ? `episode:${chunk.id}` : `episode:${chunk.id}:${runIdx}`;
      const turnIds = run.map((t) => t.id);
      const turnIdSet = new Set(turnIds);
      const startDepth = run[0].depth_index;
      const endDepth = run[run.length - 1].depth_index;
      const narrativeTurnCount = run.filter((t) => t.actor_id !== "__arrival__").length;
      const waypointCount = run.length - narrativeTurnCount;
      const intersectsActiveBranch = run.some((t) => activeBranchSet.has(t.id));
      const containsActiveLeaf =
        effectiveActiveLeafId !== null && turnIdSet.has(effectiveActiveLeafId);

      let hiddenSwipeCount = 0;
      let outgoingBranchCount = 0;
      for (const tid of turnIds) {
        hiddenSwipeCount += hiddenSwipesByAnchorId.get(tid)?.length ?? 0;
        const kids = visibleChildrenByParent.get(tid) ?? [];
        for (const kid of kids) {
          if (!turnIdSet.has(kid.id)) {
            outgoingBranchCount += 1;
          }
        }
      }

      let summaryVariants: EpisodeSummaryVariant[];
      let isInProgressOnActive = false;

      if (chunkIsActive) {
        summaryVariants = [buildChunkSummaryVariant(chunk, "active", turnById)];
      } else if (intersectsActiveBranch) {
        isInProgressOnActive = true;
        summaryVariants = [
          buildInProgressVariant(startDepth, endDepth),
          buildChunkSummaryVariant(chunk, "alternate", turnById),
        ];
      } else {
        summaryVariants = [buildChunkSummaryVariant(chunk, "alternate", turnById)];
      }

      const ep: EpisodeGroupMeta = {
        id: epId,
        episodeIndex: episodes.length + 1,
        primaryChunkId: chunk.id,
        startDepth,
        endDepth,
        turnIds,
        narrativeTurnCount,
        waypointCount,
        intersectsActiveBranch,
        containsActiveLeaf,
        hiddenSwipeCount,
        outgoingBranchCount,
        summaryVariants,
        isInProgressOnActive,
      };

      episodes.push(ep);
      episodeById[ep.id] = ep;
      for (const tid of turnIds) {
        claimedTurnIds.add(tid);
        ownerEpisodeByTurnId.set(tid, ep);
      }
    });
  }

  const defaultExpandedEpisodeIds = episodes
    .filter((ep) => ep.containsActiveLeaf)
    .map((ep) => ep.id);

  const effectiveExpandedEpisodes = new Set<string>();
  if (expandedEpisodeIds !== undefined) {
    for (const id of expandedEpisodeIds) {
      effectiveExpandedEpisodes.add(id);
    }
  } else {
    for (const ep of episodes) {
      const override = episodeExpandOverrides?.[ep.id];
      const shouldExpand = override !== undefined ? override : ep.containsActiveLeaf;
      if (shouldExpand) {
        effectiveExpandedEpisodes.add(ep.id);
      }
    }
  }
  // If user enabled global "Show swipes", expand any episode containing hidden swipes so they are visible
  if (showAllSwipes) {
    for (const ep of episodes) {
      if (ep.hiddenSwipeCount > 0) {
        effectiveExpandedEpisodes.add(ep.id);
      }
    }
  }

  const collapsedEpisodeCount = episodes.filter(
    (ep) => !effectiveExpandedEpisodes.has(ep.id)
  ).length;

  // 5. Deterministic primary-spine horizontal tree layout with episode collapsing + inline swipe expansion
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
    swipeAnchorId: string | null,
    memberEpisodeId: string | null
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
      episodeGroup: null,
      memberEpisodeId,
      description,
      hasNotableSummary,
      locationName,
      x,
      y: 0,
      width,
      height,
    };
  };

  const createEpisodeNode = (
    ep: EpisodeGroupMeta,
    parentId: string | null,
    x: number,
    outgoingCount: number
  ): BranchGraphNode => {
    const firstTurn = turnById.get(ep.turnIds[0])!;
    const lastTurn = turnById.get(ep.turnIds[ep.turnIds.length - 1])!;
    const { width, height } = getNodeDimensions("episode");
    const locationName = resolveTurnLocationName(lastTurn, locationNamesById);
    const defaultVariant = ep.summaryVariants[0];
    const tips = reachableTipsById.get(firstTurn.id) ?? [lastTurn.id];
    const uniqueDescendantTipId =
      !ep.intersectsActiveBranch && tips.length === 1 ? tips[0] : null;

    return {
      id: ep.id,
      turn: lastTurn,
      parentId,
      depth: ep.startDepth,
      kind: "episode",
      isActiveBranch: ep.intersectsActiveBranch,
      isActiveLeaf: ep.containsActiveLeaf,
      isBranchTip: outgoingCount === 0,
      uniqueDescendantTipId,
      hiddenSwipes: [],
      isExpandedSwipe: false,
      swipeAnchorId: null,
      episodicChunkLabel: formatDepthRange(ep.startDepth, ep.endDepth),
      episodeGroup: ep,
      memberEpisodeId: null,
      description: defaultVariant?.synopsis || defaultVariant?.title || "Episode Summary",
      hasNotableSummary: !ep.isInProgressOnActive,
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
    x: number,
    edgeOriginTurnDepth: number | null = null
  ): BranchGraphNode | null => {
    if (visitedLayout.has(turn.id)) return null;

    const ownerEp = ownerEpisodeByTurnId.get(turn.id);
    if (ownerEp && !effectiveExpandedEpisodes.has(ownerEp.id) && ownerEp.turnIds[0] === turn.id) {
      // Render collapsed Summary Pseudo-Node absorbing all turns in `ownerEp.turnIds`
      const epTurnSet = new Set(ownerEp.turnIds);
      for (const tid of ownerEp.turnIds) {
        visitedLayout.add(tid);
      }

      const outgoingEntries: Array<{ child: TurnNodeRecord; originDepth: number }> = [];
      for (const tid of ownerEp.turnIds) {
        const originTurn = turnById.get(tid);
        const kids = visibleChildrenByParent.get(tid) ?? [];
        for (const kid of kids) {
          if (!epTurnSet.has(kid.id)) {
            outgoingEntries.push({
              child: kid,
              originDepth: originTurn?.depth_index ?? ownerEp.endDepth,
            });
          }
        }
      }

      // Keep active-branch continuation first so the active spine stays horizontally aligned
      outgoingEntries.sort((a, b) => {
        const aActive = activeBranchSet.has(a.child.id) ? 0 : 1;
        const bActive = activeBranchSet.has(b.child.id) ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        return a.originDepth - b.originDepth;
      });

      const epNode = createEpisodeNode(ownerEp, parentId, x, outgoingEntries.length);
      nodes.push(epNode);
      nodeById[epNode.id] = epNode;

      if (parentId !== null) {
        edges.push({
          id: `${parentId}->${epNode.id}`,
          fromId: parentId,
          toId: epNode.id,
          isActiveBranch: (nodeById[parentId]?.isActiveBranch ?? false) && epNode.isActiveBranch,
          isExpandedSwipe: false,
          originTurnDepth: edgeOriginTurnDepth,
        });
      }

      const childX = x + epNode.width + COL_GAP;
      let firstChildNode: BranchGraphNode | null = null;

      if (outgoingEntries.length === 0) {
        const bandH = Math.max(epNode.height, TURN_CARD_H);
        epNode.y = nextY + bandH / 2;
        nextY += bandH + ROW_GAP;
      } else {
        for (const entry of outgoingEntries) {
          const childNode = layoutSubtree(entry.child, epNode.id, childX, entry.originDepth);
          if (!firstChildNode && childNode) {
            firstChildNode = childNode;
          }
        }
        if (firstChildNode) {
          // Ensure episode card doesn't overlap vertically above previous lane when taller than child
          const minCenterY = epNode.height / 2;
          epNode.y = Math.max(firstChildNode.y, minCenterY);
          const epBottom = epNode.y + epNode.height / 2 + ROW_GAP;
          if (epBottom > nextY) {
            nextY = epBottom;
          }
        } else {
          const bandH = Math.max(epNode.height, TURN_CARD_H);
          epNode.y = nextY + bandH / 2;
          nextY += bandH + ROW_GAP;
        }
      }

      return epNode;
    }

    visitedLayout.add(turn.id);
    const memberEpisodeId =
      ownerEp && effectiveExpandedEpisodes.has(ownerEp.id) ? ownerEp.id : null;
    const node = createGraphNode(turn, parentId, x, false, null, memberEpisodeId);
    nodes.push(node);
    nodeById[node.id] = node;

    if (parentId !== null) {
      edges.push({
        id: `${parentId}->${node.id}`,
        fromId: parentId,
        toId: node.id,
        isActiveBranch: (nodeById[parentId]?.isActiveBranch ?? false) && node.isActiveBranch,
        isExpandedSwipe: false,
        originTurnDepth: edgeOriginTurnDepth,
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
        const childNode = layoutSubtree(childTurn, node.id, childX, null);
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

    const hiddenSwipes = hiddenSwipesByAnchorId.get(turn.id) ?? [];
    if (hiddenSwipes.length > 0 && (showAllSwipes || expandedSwipeAnchorIds.has(turn.id))) {
      for (const swipeTurn of hiddenSwipes) {
        if (visitedLayout.has(swipeTurn.id)) continue;
        visitedLayout.add(swipeTurn.id);
        const swipeNode = createGraphNode(swipeTurn, parentId, x, true, node.id, null);
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
            originTurnDepth: null,
          });
        }
      }
    }

    return node;
  };

  for (const rootTurn of rootTurns) {
    layoutSubtree(rootTurn, null, 0, null);
  }

  // 6. Compute row-segmented bounding frames for expanded episodes (prevents overlapping foreign branches)
  const expandedEpisodeFrames: ExpandedEpisodeFrame[] = [];
  for (const ep of episodes) {
    if (!effectiveExpandedEpisodes.has(ep.id)) continue;
    const memberNodes = ep.turnIds
      .map((tid) => nodeById[tid])
      .filter((n): n is BranchGraphNode => Boolean(n));
    if (memberNodes.length === 0) continue;

    // Group contiguous turns that share the same horizontal row `y` (within 2px tolerance)
    const segments: ExpandedEpisodeSegment[] = [];
    const padX = 12;
    const padTop = 26;
    const padBottom = 12;

    let segNodes: BranchGraphNode[] = [];
    const flushSegment = () => {
      if (segNodes.length === 0) return;
      let sMinX = Infinity;
      let sMaxX = -Infinity;
      let sMinY = Infinity;
      let sMaxY = -Infinity;
      for (const n of segNodes) {
        sMinX = Math.min(sMinX, n.x - padX);
        sMaxX = Math.max(sMaxX, n.x + n.width + padX);
        sMinY = Math.min(sMinY, n.y - n.height / 2 - padTop);
        sMaxY = Math.max(sMaxY, n.y + n.height / 2 + padBottom);
      }
      segments.push({ minX: sMinX, maxX: sMaxX, minY: sMinY, maxY: sMaxY });
      segNodes = [];
    };

    for (const n of memberNodes) {
      if (segNodes.length === 0 || Math.abs(n.y - segNodes[segNodes.length - 1].y) <= 2) {
        segNodes.push(n);
      } else {
        flushSegment();
        segNodes.push(n);
      }
    }
    flushSegment();

    const primary = segments[0];
    expandedEpisodeFrames.push({
      episodeId: ep.id,
      episode: ep,
      segments,
      headerX: primary.minX,
      headerY: primary.minY,
      headerWidth: primary.maxX - primary.minX,
    });
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const n of nodes) {
    const top = n.y - n.height / 2;
    const bottom = n.y + n.height / 2;
    if (n.x < minX) minX = n.x;
    if (n.x + n.width > maxX) maxX = n.x + n.width;
    if (top < minY) minY = top;
    if (bottom > maxY) maxY = bottom;
  }

  for (const frame of expandedEpisodeFrames) {
    for (const seg of frame.segments) {
      if (seg.minX < minX) minX = seg.minX;
      if (seg.maxX > maxX) maxX = seg.maxX;
      if (seg.minY < minY) minY = seg.minY;
      if (seg.maxY > maxY) maxY = seg.maxY;
    }
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
    episodes,
    episodeById,
    expandedEpisodeFrames,
    defaultExpandedEpisodeIds,
    totalTurnCount,
    collapsedEpisodeCount,
    totalHiddenSwipes,
    branchTipCount: underlyingBranchTipCount,
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
 * Compute a point along the cubic Bézier edge (at parameter `t`, default 0.45) for origin labels.
 */
export function computeBranchEdgeLabelPoint(
  fromNode: Pick<BranchGraphNode, "x" | "y" | "width">,
  toNode: Pick<BranchGraphNode, "x" | "y">,
  t = 0.45
): { x: number; y: number } {
  const x1 = fromNode.x + fromNode.width;
  const y1 = fromNode.y;
  const x2 = toNode.x;
  const y2 = toNode.y;
  const dx = Math.max(24, (x2 - x1) * 0.5);
  const cx1 = x1 + dx;
  const cy1 = y1;
  const cx2 = x2 - dx;
  const cy2 = y2;
  const mt = 1 - t;
  const x =
    mt * mt * mt * x1 +
    3 * mt * mt * t * cx1 +
    3 * mt * t * t * cx2 +
    t * t * t * x2;
  const y =
    mt * mt * mt * y1 +
    3 * mt * mt * t * cy1 +
    3 * mt * t * t * cy2 +
    t * t * t * y2;
  return { x, y };
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
