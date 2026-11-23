import React from "react";
import {
  BookOpen,
  Box,
  ChevronRight,
  Clock,
  MapPin,
  Search,
  Users,
} from "lucide-react";
import type { GmMentionCandidate, GmMentionCategory } from "../../types";
import {
  GM_MENTION_CATEGORIES,
  type GmMentionTrigger,
} from "../../utils/gmMentions";

export interface GmMentionPopoverProps {
  trigger: GmMentionTrigger;
  items: GmMentionCandidate[];
  loading: boolean;
  selectedIndex: number;
  onHoverIndex: (idx: number) => void;
  onSelectCategory: (category: GmMentionCategory) => void;
  onSelectCandidate: (candidate: GmMentionCandidate) => void;
}

function CategoryIcon({
  category,
  size = 14,
}: {
  category: GmMentionCategory;
  size?: number;
}) {
  switch (category) {
    case "characters":
      return <Users size={size} className="gm-mention-icon gm-mention-icon--violet" />;
    case "lore":
      return <BookOpen size={size} className="gm-mention-icon gm-mention-icon--amber" />;
    case "locations":
      return <MapPin size={size} className="gm-mention-icon gm-mention-icon--cyan" />;
    case "containers":
      return <Box size={size} className="gm-mention-icon gm-mention-icon--emerald" />;
    case "turns":
      return <Clock size={size} className="gm-mention-icon gm-mention-icon--blue" />;
  }
}

export const GmMentionPopover: React.FC<GmMentionPopoverProps> = ({
  trigger,
  items,
  loading,
  selectedIndex,
  onHoverIndex,
  onSelectCategory,
  onSelectCandidate,
}) => {
  const isBrowse = trigger.mode === "browse";
  const categorySpec = trigger.category
    ? GM_MENTION_CATEGORIES.find((c) => c.id === trigger.category)
    : undefined;

  return (
    <div
      className="gm-mention-popover"
      role="listbox"
      aria-label={isBrowse ? "Browse mention categories" : "Mention search results"}
    >
      <div className="gm-mention-popover-header">
        <span className="gm-mention-popover-title">
          {isBrowse
            ? "Browse"
            : categorySpec
              ? `${categorySpec.label}${trigger.query ? ` · "${trigger.query}"` : ""}`
              : `Search · "${trigger.query}"`}
        </span>
        {!isBrowse && (
          <span className="gm-mention-popover-count">
            {loading ? "Searching…" : `${items.length} result${items.length === 1 ? "" : "s"}`}
          </span>
        )}
      </div>

      {isBrowse ? (
        <div className="gm-mention-list">
          {GM_MENTION_CATEGORIES.map((cat, idx) => {
            const active = idx === selectedIndex;
            return (
              <button
                key={cat.id}
                type="button"
                role="option"
                aria-selected={active}
                className={`gm-mention-row ${active ? "gm-mention-row--active" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelectCategory(cat.id);
                }}
                onMouseEnter={() => onHoverIndex(idx)}
              >
                <CategoryIcon category={cat.id} />
                <div className="gm-mention-row-body">
                  <span className="gm-mention-row-label">{cat.label}</span>
                  <span className="gm-mention-row-sub">{cat.description}</span>
                </div>
                <ChevronRight size={13} className="gm-mention-row-chevron" />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="gm-mention-list">
          {loading && items.length === 0 ? (
            <div className="gm-mention-empty">
              <Search size={13} />
              <span>Searching campaign state…</span>
            </div>
          ) : items.length === 0 ? (
            <div className="gm-mention-empty">
              <Search size={13} />
              <span>No matching entries found.</span>
            </div>
          ) : (
            items.map((cand, idx) => {
              const active = idx === selectedIndex;
              return (
                <button
                  key={`${cand.kind}:${cand.id}`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`gm-mention-row ${active ? "gm-mention-row--active" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelectCandidate(cand);
                  }}
                  onMouseEnter={() => onHoverIndex(idx)}
                >
                  <CategoryIcon category={cand.category} />
                  <div className="gm-mention-row-body">
                    <span className="gm-mention-row-label">{cand.label}</span>
                    {cand.subtitle && (
                      <span className="gm-mention-row-sub">{cand.subtitle}</span>
                    )}
                  </div>
                  {cand.badge && (
                    <span className="gm-mention-row-badge">{cand.badge}</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}

      <div className="gm-mention-popover-footer">
        {isBrowse ? (
          <span>↑↓ navigate · Enter/Tab open category · esc to exit</span>
        ) : (
          <span>
            ↑↓ navigate · Enter select ·{" "}
            {trigger.mode === "category" && !trigger.query ? "Backspace back · " : ""}
            esc to exit
          </span>
        )}
      </div>
    </div>
  );
};
