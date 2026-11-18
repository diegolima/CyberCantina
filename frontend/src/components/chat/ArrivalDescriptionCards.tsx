import React, { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Layers,
  MapPin,
  Maximize2,
} from "lucide-react";
import type { FirstVisitDescriptionCard, FirstVisitMediaItem } from "../../types";
import { ImageLightboxModal } from "../shared/ImageLightboxModal";
import {
  getArrivalScopeLabel,
  isArrivalCardExpanded,
  isArrivalInnerItemExpanded,
  makeArrivalCardKey,
} from "./arrivalHelpers";
import {
  filterAvailableArrivalMedia,
  getArrivalMediaDisplayLabel,
  makeArrivalMediaCardKey,
  stepCarouselIndex,
} from "./arrivalMediaHelpers";

export interface ArrivalDescriptionCardsProps {
  turnId: string;
  lastTurnId: string | undefined;
  cards: FirstVisitDescriptionCard[];
  mediaItems?: FirstVisitMediaItem[];
  manualOverrides: Record<string, boolean>;
  onToggleCard: (cardKey: string, currentlyExpanded: boolean) => void;
  /** Optional pre-filtered media list supplied by StandaloneArrivalCard. */
  visibleMediaOverride?: FirstVisitMediaItem[];
  /** Optional shared error handler supplied by StandaloneArrivalCard. */
  onMediaError?: (imageUrl: string) => void;
  /** Optional controlled carousel index supplied by StandaloneArrivalCard. */
  slideIdxOverride?: number;
  /** Optional controlled carousel setter supplied by StandaloneArrivalCard. */
  onSlideIdxChange?: (nextIdx: number) => void;
  /** When true (single renderable item inside StandaloneArrivalCard), omit the inner toggle header. */
  singleItemBare?: boolean;
  /** Whether inner cards default to expanded inside an open outer arrival card (defaults to true). */
  defaultInnerExpanded?: boolean;
}

/**
 * Collapsible stack of cosmetic first-visit arrival description cards and a unified arrival-media carousel.
 */
export const ArrivalDescriptionCards: React.FC<ArrivalDescriptionCardsProps> = ({
  turnId,
  lastTurnId,
  cards,
  mediaItems = [],
  manualOverrides,
  onToggleCard,
  visibleMediaOverride,
  onMediaError,
  slideIdxOverride,
  onSlideIdxChange,
  singleItemBare = false,
  defaultInnerExpanded = true,
}) => {
  const [localFailedUrls, setLocalFailedUrls] = useState<Record<string, boolean>>({});
  const [localSlideIdx, setLocalSlideIdx] = useState(0);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  const visibleMedia = useMemo(
    () =>
      visibleMediaOverride ??
      filterAvailableArrivalMedia(mediaItems, localFailedUrls),
    [visibleMediaOverride, mediaItems, localFailedUrls]
  );

  const slideIdx = slideIdxOverride ?? localSlideIdx;
  const setSlideIdx = (updater: number | ((prev: number) => number)) => {
    const next = typeof updater === "function" ? updater(slideIdx) : updater;
    if (onSlideIdxChange) {
      onSlideIdxChange(next);
    } else {
      setLocalSlideIdx(next);
    }
  };

  useEffect(() => {
    setIsLightboxOpen(false);
    setLocalSlideIdx(0);
  }, [turnId]);

  useEffect(() => {
    if (visibleMedia.length === 0) {
      setIsLightboxOpen(false);
    } else if (slideIdx >= visibleMedia.length) {
      if (onSlideIdxChange) {
        onSlideIdxChange(0);
      } else {
        setLocalSlideIdx(0);
      }
    }
  }, [slideIdx, visibleMedia.length, onSlideIdxChange]);

  const hasCards = Boolean(cards && cards.length > 0);
  const hasMedia = visibleMedia.length > 0;
  if (!hasCards && !hasMedia) return null;

  const resolveInnerExpanded = (cardKey: string) =>
    defaultInnerExpanded
      ? isArrivalInnerItemExpanded({ cardKey, manualOverrides })
      : isArrivalCardExpanded({
          turnId,
          lastTurnId,
          cardKey,
          manualOverrides,
        });

  const mediaCardKey = makeArrivalMediaCardKey(turnId);
  const mediaExpanded = singleItemBare ? true : resolveInnerExpanded(mediaCardKey);
  const activeSlide =
    visibleMedia[Math.min(slideIdx, Math.max(0, visibleMedia.length - 1))];

  const handleImageError = (imageUrl: string) => {
    if (onMediaError) {
      onMediaError(imageUrl);
    } else {
      setLocalFailedUrls((prev) => ({
        ...prev,
        [imageUrl]: true,
      }));
    }
  };

  const renderMediaBody = (slide: FirstVisitMediaItem, bare: boolean) => {
    const slideSubtitle =
      slide.label.trim() && slide.label.trim() !== slide.entity_name
        ? slide.entity_name
        : "";
    return (
      <div className={`arrival-media-body ${bare ? "arrival-media-body--bare" : ""}`}>
        <div className="arrival-media-frame">
          <img
            src={slide.image_url}
            alt={getArrivalMediaDisplayLabel(slide)}
            className="arrival-media-img"
            onClick={() => setIsLightboxOpen(true)}
            onError={() => handleImageError(slide.image_url)}
          />
          <button
            type="button"
            className="arrival-media-enlarge-btn"
            onClick={() => setIsLightboxOpen(true)}
            title="Enlarge image"
            aria-label="Enlarge arrival image"
          >
            <Maximize2 size={12} />
          </button>

          {visibleMedia.length > 1 && (
            <>
              <button
                type="button"
                className="arrival-media-nav-btn arrival-media-nav-btn--prev"
                onClick={() =>
                  setSlideIdx((prev) =>
                    stepCarouselIndex(prev, -1, visibleMedia.length)
                  )
                }
                aria-label="Previous arrival image"
              >
                <ChevronLeft size={15} />
              </button>
              <button
                type="button"
                className="arrival-media-nav-btn arrival-media-nav-btn--next"
                onClick={() =>
                  setSlideIdx((prev) =>
                    stepCarouselIndex(prev, 1, visibleMedia.length)
                  )
                }
                aria-label="Next arrival image"
              >
                <ChevronRight size={15} />
              </button>
            </>
          )}
        </div>

        <div className="arrival-media-caption-bar">
          <span className="arrival-media-caption-text">
            {getArrivalMediaDisplayLabel(slide)}
            {slideSubtitle && (
              <span className="arrival-media-caption-entity">
                {" "}
                · {slide.entity_name}
              </span>
            )}
          </span>
          {visibleMedia.length > 1 && (
            <div className="arrival-media-dots">
              {visibleMedia.map((item, idx) => (
                <button
                  key={`${item.entity_type}-${item.entity_id}-${item.media_id}`}
                  type="button"
                  className={`arrival-media-dot ${idx === slideIdx ? "active" : ""}`}
                  onClick={() => setSlideIdx(idx)}
                  aria-label={`View slide ${idx + 1}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="arrival-cards-stack">
        {hasMedia && activeSlide && (
          <div
            className={`arrival-card-item ${
              mediaExpanded ? "arrival-card-item--open" : ""
            }`}
          >
            {!singleItemBare && (
              <button
                type="button"
                className="arrival-card-header"
                aria-expanded={mediaExpanded}
                onClick={() => onToggleCard(mediaCardKey, mediaExpanded)}
              >
                <span className="arrival-card-title-group">
                  {mediaExpanded ? (
                    <ChevronDown size={13} color="#34d399" />
                  ) : (
                    <ChevronRight size={13} color="#94a3b8" />
                  )}
                  <ImageIcon size={13} color="#34d399" />
                  <span className="arrival-card-title">
                    {visibleMedia.length > 1
                      ? `Arrival Visuals (${visibleMedia.length})`
                      : getArrivalMediaDisplayLabel(activeSlide)}
                  </span>
                </span>
                <span className="arrival-card-scope-badge">
                  {visibleMedia.length > 1
                    ? `${slideIdx + 1}/${visibleMedia.length}`
                    : getArrivalScopeLabel(activeSlide.entity_type, activeSlide.depth)}
                </span>
              </button>
            )}

            {mediaExpanded && renderMediaBody(activeSlide, singleItemBare)}
          </div>
        )}

        {cards.map((card) => {
          const cardKey = makeArrivalCardKey(turnId, card.entity_type, card.entity_id);
          const expanded = singleItemBare ? true : resolveInnerExpanded(cardKey);
          const isContainer = card.entity_type === "container";
          const scopeLabel = getArrivalScopeLabel(card.entity_type, card.depth);

          return (
            <div
              key={cardKey}
              className={`arrival-card-item ${
                expanded ? "arrival-card-item--open" : ""
              }`}
            >
              {!singleItemBare && (
                <button
                  type="button"
                  className="arrival-card-header"
                  aria-expanded={expanded}
                  onClick={() => onToggleCard(cardKey, expanded)}
                >
                  <span className="arrival-card-title-group">
                    {expanded ? (
                      <ChevronDown size={13} color="#34d399" />
                    ) : (
                      <ChevronRight size={13} color="#94a3b8" />
                    )}
                    {isContainer ? (
                      <Layers size={13} color="#fbbf24" />
                    ) : (
                      <MapPin size={13} color="#34d399" />
                    )}
                    <span className="arrival-card-title">{card.title}</span>
                  </span>
                  <span className="arrival-card-scope-badge">{scopeLabel}</span>
                </button>
              )}
              {expanded && (
                <div
                  className={`arrival-card-body ${
                    singleItemBare ? "arrival-card-body--bare" : ""
                  }`}
                >
                  {card.description}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isLightboxOpen && activeSlide && (
        <ImageLightboxModal
          url={activeSlide.image_url}
          label={getArrivalMediaDisplayLabel(activeSlide)}
          subtitle={
            activeSlide.label.trim() &&
            activeSlide.label.trim() !== activeSlide.entity_name
              ? activeSlide.entity_name
              : undefined
          }
          counterText={
            visibleMedia.length > 1
              ? `${Math.min(slideIdx, visibleMedia.length - 1) + 1} / ${visibleMedia.length}`
              : undefined
          }
          onPrev={
            visibleMedia.length > 1
              ? () =>
                  setSlideIdx((prev) =>
                    stepCarouselIndex(prev, -1, visibleMedia.length)
                  )
              : undefined
          }
          onNext={
            visibleMedia.length > 1
              ? () =>
                  setSlideIdx((prev) =>
                    stepCarouselIndex(prev, 1, visibleMedia.length)
                  )
              : undefined
          }
          onImageError={() => handleImageError(activeSlide.image_url)}
          onClose={() => setIsLightboxOpen(false)}
        />
      )}
    </>
  );
};
