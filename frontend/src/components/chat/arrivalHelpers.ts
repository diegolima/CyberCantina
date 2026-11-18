import type {
  FirstVisitDescriptionCard,
  FirstVisitMediaItem,
  TurnNodeRecord,
} from "../../types";
import { getArrivalMediaDisplayLabel } from "./arrivalMediaHelpers";

/** Stable UI key identifying the outer collapsible standalone arrival card for a turn. */
export function makeArrivalGroupKey(turnId: string): string {
  return `${turnId}:group`;
}

/** Stable UI key identifying an individual first-visit description card within a branch turn. */
export function makeArrivalCardKey(
  turnId: string,
  entityType: "container" | "location",
  entityId: string
): string {
  return `${turnId}:${entityType}:${entityId}`;
}

/**
 * Determine whether an outer arrival card (or standalone card key) is currently expanded.
 * Only cards belonging to the latest turn default to expanded; when a new turn occurs,
 * all prior cards automatically collapse unless manually reopened after that turn.
 */
export function isArrivalCardExpanded(params: {
  turnId: string;
  lastTurnId: string | undefined;
  cardKey: string;
  manualOverrides: Record<string, boolean>;
}): boolean {
  const { turnId, lastTurnId, cardKey, manualOverrides } = params;
  if (Object.prototype.hasOwnProperty.call(manualOverrides, cardKey)) {
    return manualOverrides[cardKey];
  }
  return Boolean(lastTurnId && turnId === lastTurnId);
}

/**
 * Determine whether an inner arrival element (visuals or individual description card)
 * is expanded inside an already-open outer arrival card. Defaults to expanded so
 * reopening a collapsed past arrival card immediately reveals its contents in one click.
 */
export function isArrivalInnerItemExpanded(params: {
  cardKey: string;
  manualOverrides: Record<string, boolean>;
}): boolean {
  const { cardKey, manualOverrides } = params;
  if (Object.prototype.hasOwnProperty.call(manualOverrides, cardKey)) {
    return manualOverrides[cardKey];
  }
  return true;
}

/** Return the active branch's leaf turn ID for auto-collapse tracking. */
export function getLatestBranchTurnId(turns: TurnNodeRecord[]): string | undefined {
  return turns.length > 0 ? turns[turns.length - 1].id : undefined;
}

/** Format the scope pill label for a container or location arrival card. */
export function getArrivalScopeLabel(
  entityType: "container" | "location",
  depth: number
): string {
  if (entityType === "container") {
    return depth > 0 ? `L${depth} Area` : "Area";
  }
  return "Location";
}

export interface ArrivalHeaderSummary {
  title: string;
  badgeText: string | null;
  iconKind: "compass" | "container" | "location" | "media";
}

/**
 * Build a concise, deterministic outer header summary for a standalone arrival card.
 * Single-item groups surface that item's own icon, title, and scope/slide badge directly;
 * multi-item groups show the outer-to-inner breadcrumb and an item-count summary badge.
 */
export function buildArrivalHeaderSummary(params: {
  cards: FirstVisitDescriptionCard[];
  visibleMedia: FirstVisitMediaItem[];
  slideIdx: number;
}): ArrivalHeaderSummary {
  const { cards, visibleMedia, slideIdx } = params;
  const hasMedia = visibleMedia.length > 0;
  const renderableCount = cards.length + (hasMedia ? 1 : 0);

  if (renderableCount === 1 && cards.length === 1) {
    const only = cards[0];
    return {
      title: only.title,
      badgeText: getArrivalScopeLabel(only.entity_type, only.depth),
      iconKind: only.entity_type === "container" ? "container" : "location",
    };
  }

  if (renderableCount === 1 && hasMedia) {
    const safeIdx = Math.min(slideIdx, Math.max(0, visibleMedia.length - 1));
    const activeSlide = visibleMedia[safeIdx];
    return {
      title:
        visibleMedia.length > 1
          ? `Arrival Visuals (${visibleMedia.length})`
          : getArrivalMediaDisplayLabel(activeSlide),
      badgeText:
        visibleMedia.length > 1
          ? `${safeIdx + 1}/${visibleMedia.length}`
          : getArrivalScopeLabel(activeSlide.entity_type, activeSlide.depth),
      iconKind: "media",
    };
  }

  const title =
    cards.length > 0
      ? cards.map((c) => c.title).join(" › ")
      : visibleMedia.length > 1
      ? `Arrival Visuals (${visibleMedia.length})`
      : visibleMedia.length === 1
      ? getArrivalMediaDisplayLabel(visibleMedia[0])
      : "Arrival Description";

  const parts: string[] = [];
  if (cards.length > 0) {
    parts.push(`${cards.length} ${cards.length === 1 ? "card" : "cards"}`);
  }
  if (hasMedia) {
    parts.push(
      visibleMedia.length > 1 ? `${visibleMedia.length} visuals` : "Visual"
    );
  }

  return {
    title,
    badgeText: parts.length > 0 ? parts.join(" · ") : null,
    iconKind: "compass",
  };
}
