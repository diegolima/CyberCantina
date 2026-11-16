import React from "react";
import { ChevronDown, ChevronRight, Layers, MapPin } from "lucide-react";
import type { FirstVisitDescriptionCard } from "../../types";
import { isArrivalCardExpanded, makeArrivalCardKey } from "./arrivalHelpers";

export interface ArrivalDescriptionCardsProps {
  turnId: string;
  lastTurnId: string | undefined;
  cards: FirstVisitDescriptionCard[];
  manualOverrides: Record<string, boolean>;
  onToggleCard: (cardKey: string, currentlyExpanded: boolean) => void;
}

/**
 * Collapsible stack of cosmetic first-visit description cards for nested containers and locations.
 */
export const ArrivalDescriptionCards: React.FC<ArrivalDescriptionCardsProps> = ({
  turnId,
  lastTurnId,
  cards,
  manualOverrides,
  onToggleCard,
}) => {
  if (!cards || cards.length === 0) return null;

  return (
    <div className="arrival-cards-stack">
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
  );
};
