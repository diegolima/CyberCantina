import type { FirstVisitMediaItem } from "../../types";

/** Stable UI key for a turn's arrival-media carousel card. */
export function makeArrivalMediaCardKey(turnId: string): string {
  return `${turnId}:media:carousel`;
}

/** Resolve the display label for an arrival media slide, falling back to the entity name. */
export function getArrivalMediaDisplayLabel(item: FirstVisitMediaItem): string {
  const custom = (item.label || "").trim();
  if (custom) return custom;
  return (item.entity_name || "").trim() || "Location Visual";
}

/** Return visible arrival media items after filtering out any URLs that failed to load. */
export function filterAvailableArrivalMedia(
  items: FirstVisitMediaItem[],
  failedUrls: Record<string, boolean>
): FirstVisitMediaItem[] {
  return items.filter((item) => Boolean(item.image_url) && !failedUrls[item.image_url]);
}

/** Wrap a carousel slide index safely within [0, count - 1]. */
export function stepCarouselIndex(
  current: number,
  delta: number,
  count: number
): number {
  if (count <= 0) return 0;
  return ((current + delta) % count + count) % count;
}
