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
import { isArrivalCardExpanded, makeArrivalCardKey } from "./arrivalHelpers";
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
}) => {
  const [failedUrls, setFailedUrls] = useState<Record<string, boolean>>({});
  const [slideIdx, setSlideIdx] = useState(0);
  const [lightboxSlide, setLightboxSlide] = useState<{
    url: string;
    label: string;
    subtitle: string;
  } | null>(null);

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

  const mediaCardKey = makeArrivalMediaCardKey(turnId);
  const mediaExpanded = isArrivalCardExpanded({
    turnId,
    lastTurnId,
    cardKey: mediaCardKey,
    manualOverrides,
  });
  const activeSlide = visibleMedia[Math.min(slideIdx, Math.max(0, visibleMedia.length - 1))];

  return (
    <>
      <div className="arrival-cards-stack">
        {hasMedia && activeSlide && (
          <div
            className={`arrival-card-item ${mediaExpanded ? "arrival-card-item--open" : ""}`}
          >
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
                  : activeSlide.entity_type === "container"
                  ? activeSlide.depth > 0
                    ? `L${activeSlide.depth} Area`
                    : "Area"
                  : "Location"}
              </span>
            </button>

            {mediaExpanded && (
              <div className="arrival-media-body">
                <div className="arrival-media-frame">
                  <img
                    src={activeSlide.image_url}
                    alt={getArrivalMediaDisplayLabel(activeSlide)}
                    className="arrival-media-img"
                    onClick={() =>
                      setLightboxSlide({
                        url: activeSlide.image_url,
                        label: getArrivalMediaDisplayLabel(activeSlide),
                        subtitle:
                          activeSlide.label.trim() &&
                          activeSlide.label.trim() !== activeSlide.entity_name
                            ? activeSlide.entity_name
                            : "",
                      })
                    }
                    onError={() =>
                      setFailedUrls((prev) => ({
                        ...prev,
                        [activeSlide.image_url]: true,
                      }))
                    }
                  />
                  <button
                    type="button"
                    className="arrival-media-enlarge-btn"
                    onClick={() =>
                      setLightboxSlide({
                        url: activeSlide.image_url,
                        label: getArrivalMediaDisplayLabel(activeSlide),
                        subtitle:
                          activeSlide.label.trim() &&
                          activeSlide.label.trim() !== activeSlide.entity_name
                            ? activeSlide.entity_name
                            : "",
                      })
                    }
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
                    {getArrivalMediaDisplayLabel(activeSlide)}
                    {activeSlide.label.trim() &&
                      activeSlide.label.trim() !== activeSlide.entity_name && (
                        <span className="arrival-media-caption-entity">
                          {" "}
                          · {activeSlide.entity_name}
                        </span>
                      )}
                  </span>
                  {visibleMedia.length > 1 && (
                    <div className="arrival-media-dots">
                      {visibleMedia.map((item, idx) => (
                        <button
                          key={`${item.entity_type}-${item.entity_id}-${item.media_id}`}
                          type="button"
                          className={`arrival-media-dot ${
                            idx === slideIdx ? "active" : ""
                          }`}
                          onClick={() => setSlideIdx(idx)}
                          aria-label={`View slide ${idx + 1}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {cards.map((card) => {
          const cardKey = makeArrivalCardKey(turnId, card.entity_type, card.entity_id);
          const expanded = isArrivalCardExpanded({
            turnId,
            lastTurnId,
            cardKey,
            manualOverrides,
          });
          const isContainer = card.entity_type === "container";
          const scopeLabel = isContainer
            ? card.depth > 0
              ? `L${card.depth} Area`
              : "Area"
            : "Location";

          return (
            <div
              key={cardKey}
              className={`arrival-card-item ${expanded ? "arrival-card-item--open" : ""}`}
            >
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
              {expanded && (
                <div className="arrival-card-body">{card.description}</div>
              )}
            </div>
          );
        })}
      </div>

      {lightboxSlide && (
        <ImageLightboxModal
          url={lightboxSlide.url}
          label={lightboxSlide.label}
          subtitle={lightboxSlide.subtitle || undefined}
          onClose={() => setLightboxSlide(null)}
        />
      )}
    </>
  );
};
