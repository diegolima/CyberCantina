import React, { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Compass,
  Image as ImageIcon,
  Layers,
  MapPin,
  Trash2,
} from "lucide-react";
import type { FirstVisitDescriptionCard, FirstVisitMediaItem } from "../../types";
import { ArrivalDescriptionCards } from "./ArrivalDescriptionCards";
import {
  buildArrivalHeaderSummary,
  isArrivalCardExpanded,
  makeArrivalGroupKey,
} from "./arrivalHelpers";
import { filterAvailableArrivalMedia } from "./arrivalMediaHelpers";

export type ArrivalCardSource = "scene_start" | "clerk" | "map";

export interface StandaloneArrivalCardProps {
  turnId: string;
  lastTurnId: string | undefined;
  worldTimestamp: string;
  source: ArrivalCardSource;
  turnDepthIndex: number;
  cards: FirstVisitDescriptionCard[];
  mediaItems?: FirstVisitMediaItem[];
  manualOverrides: Record<string, boolean>;
  onToggleCard: (cardKey: string, currentlyExpanded: boolean) => void;
  showDelete?: boolean;
  deleteDisabled?: boolean;
  onDelete?: () => void;
}

/**
 * Unified standalone first-visit arrival card rendered for Turn 0 scene openings,
 * Phase 5 Clerk transitions, and manual map moves.
 */
export const StandaloneArrivalCard: React.FC<StandaloneArrivalCardProps> = ({
  turnId,
  lastTurnId,
  worldTimestamp,
  source,
  turnDepthIndex,
  cards,
  mediaItems = [],
  manualOverrides,
  onToggleCard,
  showDelete = false,
  deleteDisabled = false,
  onDelete,
}) => {
  const [failedUrls, setFailedUrls] = useState<Record<string, boolean>>({});
  const [slideIdx, setSlideIdx] = useState(0);

  const visibleMedia = useMemo(
    () => filterAvailableArrivalMedia(mediaItems, failedUrls),
    [mediaItems, failedUrls]
  );

  useEffect(() => {
    setSlideIdx(0);
  }, [turnId]);

  useEffect(() => {
    if (slideIdx >= visibleMedia.length && visibleMedia.length > 0) {
      setSlideIdx(0);
    }
  }, [slideIdx, visibleMedia.length]);

  const hasCards = Boolean(cards && cards.length > 0);
  const hasMedia = visibleMedia.length > 0;
  if (!hasCards && !hasMedia) return null;

  const groupKey = makeArrivalGroupKey(turnId);
  const groupExpanded = isArrivalCardExpanded({
    turnId,
    lastTurnId,
    cardKey: groupKey,
    manualOverrides,
  });

  const renderableItemCount = cards.length + (hasMedia ? 1 : 0);
  const summary = buildArrivalHeaderSummary({
    cards,
    visibleMedia,
    slideIdx,
  });

  const sourceLabel =
    source === "scene_start"
      ? "Scene Opening"
      : source === "map"
      ? "Map Move"
      : `Arrived via Turn #${turnDepthIndex}`;

  const renderLeadingIcon = () => {
    if (summary.iconKind === "container") {
      return <Layers size={13} color="#fbbf24" style={{ flexShrink: 0 }} />;
    }
    if (summary.iconKind === "location") {
      return <MapPin size={13} color="#34d399" style={{ flexShrink: 0 }} />;
    }
    if (summary.iconKind === "media") {
      return <ImageIcon size={13} color="#34d399" style={{ flexShrink: 0 }} />;
    }
    return <Compass size={13} color="#34d399" style={{ flexShrink: 0 }} />;
  };

  return (
    <div
      className={`turn-card arrival-turn-card ${
        groupExpanded ? "arrival-turn-card--open" : "arrival-turn-card--collapsed"
      }`}
    >
      <div className="arrival-turn-header">
        <button
          type="button"
          className="arrival-turn-header-toggle"
          aria-expanded={groupExpanded}
          onClick={() => onToggleCard(groupKey, groupExpanded)}
        >
          {groupExpanded ? (
            <ChevronDown size={13} color="#34d399" style={{ flexShrink: 0 }} />
          ) : (
            <ChevronRight size={13} color="#94a3b8" style={{ flexShrink: 0 }} />
          )}
          {renderLeadingIcon()}
          <span className="arrival-turn-summary" title={summary.title}>
            {summary.title}
          </span>
          {summary.badgeText && (
            <span className="arrival-card-scope-badge">{summary.badgeText}</span>
          )}
        </button>

        <div className="arrival-turn-meta">
          <span className="arrival-turn-source">{sourceLabel}</span>
          <span>• {worldTimestamp}</span>
          {source === "map" && showDelete && onDelete && (
            <button
              type="button"
              className="btn btn-danger"
              style={{ padding: "2px 7px", fontSize: "0.69rem" }}
              disabled={deleteDisabled}
              onClick={onDelete}
              title="Undo map move & remove arrival description"
            >
              <Trash2 size={11} />
              Delete
            </button>
          )}
        </div>
      </div>

      {groupExpanded && (
        <ArrivalDescriptionCards
          turnId={turnId}
          lastTurnId={lastTurnId}
          cards={cards}
          mediaItems={mediaItems}
          visibleMediaOverride={visibleMedia}
          onMediaError={(imageUrl) =>
            setFailedUrls((prev) => ({
              ...prev,
              [imageUrl]: true,
            }))
          }
          slideIdxOverride={slideIdx}
          onSlideIdxChange={setSlideIdx}
          manualOverrides={manualOverrides}
          onToggleCard={onToggleCard}
          singleItemBare={renderableItemCount === 1}
          defaultInnerExpanded={true}
        />
      )}
    </div>
  );
};
