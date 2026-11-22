import type { TurnNodeRecord } from "../../types";

export interface StoryBookmarkItem {
  turn: TurnNodeRecord;
  /** 1-based swipe ordinal when multiple turns share the same parent + user_message. */
  swipeIndex: number | null;
  swipeTotal: number;
  isOnActiveTimeline: boolean;
  locationName: string;
  noteText: string;
  notableSummary: string;
  fallbackPreview: string;
}

function resolveBookmarkLocationName(
  turn: TurnNodeRecord,
  locationNamesById: Record<string, string>
): string {
  const locId = turn.world_snapshot?.active_location_id;
  if (locId && locationNamesById[locId]) {
    return locationNamesById[locId];
  }
  const cards = turn.post_turn?.first_visit_cards;
  if (cards && cards.length > 0) {
    const locCard =
      cards.find((c) => c.entity_type === "location") ?? cards[cards.length - 1];
    if (locCard?.title) {
      return locCard.title;
    }
  }
  return locId || "Unknown Location";
}

function resolveBookmarkFallbackPreview(turn: TurnNodeRecord): string {
  const prompt = (turn.user_message || "").replace(/\s+/g, " ").trim();
  const prose = (turn.raw_prose || "").replace(/\s+/g, " ").trim();
  const raw = prompt || prose || `Turn #${turn.depth_index}`;
  return raw.length > 160 ? `${raw.slice(0, 159)}…` : raw;
}

/**
 * Collect eligible bookmarked turns across all timelines, sorted by Turn # (depth_index)
 * with sibling swipe / creation order as tie-breaker.
 */
export function buildStoryBookmarkItems(
  allTurns: TurnNodeRecord[],
  activeBranchTurns: TurnNodeRecord[],
  locationNamesById: Record<string, string> = {}
): StoryBookmarkItem[] {
  if (!allTurns || allTurns.length === 0) return [];

  const activeSet = new Set(activeBranchTurns.map((t) => t.id));
  const orderIndexById = new Map(allTurns.map((t, idx) => [t.id, idx]));

  // Group siblings sharing (parent_turn_id, user_message) to derive v1/v2 swipe indices
  const swipeGroups = new Map<string, TurnNodeRecord[]>();
  for (const t of allTurns) {
    if (t.depth_index <= 0 || t.actor_id === "__arrival__") continue;
    const key = `${t.parent_turn_id ?? "ROOT"}::${t.user_message}`;
    const list = swipeGroups.get(key) ?? [];
    list.push(t);
    swipeGroups.set(key, list);
  }

  const swipeMetaById = new Map<string, { index: number | null; total: number }>();
  for (const group of swipeGroups.values()) {
    group.sort((a, b) => {
      const cmpCreated = (a.created_at || "").localeCompare(b.created_at || "");
      if (cmpCreated !== 0) return cmpCreated;
      return (orderIndexById.get(a.id) ?? 0) - (orderIndexById.get(b.id) ?? 0);
    });
    const total = group.length;
    group.forEach((t, idx) => {
      swipeMetaById.set(t.id, {
        index: total > 1 ? idx + 1 : null,
        total,
      });
    });
  }

  const items: StoryBookmarkItem[] = [];
  for (const turn of allTurns) {
    if (!turn.is_bookmarked || turn.depth_index <= 0 || turn.actor_id === "__arrival__") {
      continue;
    }
    const swipeMeta = swipeMetaById.get(turn.id) ?? { index: null, total: 1 };
    items.push({
      turn,
      swipeIndex: swipeMeta.index,
      swipeTotal: swipeMeta.total,
      isOnActiveTimeline: activeSet.has(turn.id),
      locationName: resolveBookmarkLocationName(turn, locationNamesById),
      noteText: (turn.user_note || "").trim(),
      notableSummary: (turn.post_turn?.notable_event_summary || "").trim(),
      fallbackPreview: resolveBookmarkFallbackPreview(turn),
    });
  }

  items.sort((a, b) => {
    if (a.turn.depth_index !== b.turn.depth_index) {
      return a.turn.depth_index - b.turn.depth_index;
    }
    const sameSwipePrompt =
      (a.turn.parent_turn_id ?? null) === (b.turn.parent_turn_id ?? null) &&
      a.turn.user_message === b.turn.user_message;
    if (sameSwipePrompt) {
      const swDiff = (a.swipeIndex ?? 0) - (b.swipeIndex ?? 0);
      if (swDiff !== 0) return swDiff;
    }
    const cmpCreated = (a.turn.created_at || "").localeCompare(b.turn.created_at || "");
    if (cmpCreated !== 0) return cmpCreated;
    return a.turn.id.localeCompare(b.turn.id);
  });

  return items;
}

/**
 * Live case-insensitive multi-token keyword filter strictly against `user_note`.
 */
export function filterStoryBookmarkItems(
  items: StoryBookmarkItem[],
  rawQuery: string
): StoryBookmarkItem[] {
  const normalized = rawQuery.trim().toLowerCase();
  if (!normalized) return items;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return items;
  return items.filter((item) => {
    const noteLower = item.noteText.toLowerCase();
    return tokens.every((tok) => noteLower.includes(tok));
  });
}
