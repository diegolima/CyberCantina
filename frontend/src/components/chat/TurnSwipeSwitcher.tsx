import React, { useEffect, useRef } from "react";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  X,
} from "lucide-react";
import type { TurnNodeRecord } from "../../types";

export interface SwipePreviewResult {
  isEditedPrompt: boolean;
  preview: string;
}

function truncatePreview(text: string, maxLen = 90): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
}

/**
 * Derive a compact 1-line preview for a sibling swipe, highlighting when the
 * player prompt itself was edited relative to the first sibling.
 */
export function buildSwipePreviewText(
  sibling: Pick<TurnNodeRecord, "user_message" | "raw_prose">,
  firstSiblingPrompt: string
): SwipePreviewResult {
  const ownPrompt = (sibling.user_message ?? "").trim();
  const basePrompt = (firstSiblingPrompt ?? "").trim();
  const isEditedPrompt = Boolean(ownPrompt && basePrompt && ownPrompt !== basePrompt);
  const rawSource = isEditedPrompt
    ? ownPrompt
    : (sibling.raw_prose ?? "").trim() || ownPrompt;

  return {
    isEditedPrompt,
    preview: truncatePreview(rawSource, 90),
  };
}

export interface TurnSwipeSwitcherProps {
  turn: TurnNodeRecord;
  siblings: TurnNodeRecord[];
  childCountByTurnId?: Record<string, number>;
  isBusy: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelectTurn: (turnId: string) => void;
}

/**
 * Compact segmented swipe-version stepper (`‹ v2/6 ›`) paired with an anchored
 * popover listing all sibling swipes, prompt/prose previews, bookmarks, and
 * descendant branch counts.
 */
export const TurnSwipeSwitcher: React.FC<TurnSwipeSwitcherProps> = ({
  turn,
  siblings,
  childCountByTurnId,
  isBusy,
  isOpen,
  onToggle,
  onClose,
  onSelectTurn,
}) => {
  const anchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (siblings.length <= 1) {
    return null;
  }

  const foundIdx = siblings.findIndex((s) => s.id === turn.id);
  const activeIndex = foundIdx >= 0 ? foundIdx : 0;
  const firstPrompt = siblings[0]?.user_message ?? "";
  const popoverId = `turn-swipe-popover-${turn.id}`;

  const selectSibling = (targetId: string) => {
    onClose();
    if (targetId !== turn.id) {
      onSelectTurn(targetId);
    }
  };

  return (
    <div ref={anchorRef} className="turn-swipe-anchor">
      <div
        className="turn-swipe-switcher"
        role="group"
        aria-label={`Swipe versions (${activeIndex + 1} of ${siblings.length})`}
      >
        <button
          type="button"
          className="btn turn-swipe-step-btn"
          disabled={isBusy || activeIndex <= 0}
          aria-label="Previous swipe version"
          title="Previous swipe version"
          onClick={(e) => {
            e.stopPropagation();
            const prev = siblings[activeIndex - 1];
            if (prev) selectSibling(prev.id);
          }}
        >
          <ChevronLeft size={12} aria-hidden="true" />
        </button>

        <button
          type="button"
          className={`btn turn-swipe-trigger-btn${
            isOpen ? " turn-swipe-trigger-btn--open" : ""
          }`}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-controls={popoverId}
          aria-label={`Swipe version ${activeIndex + 1} of ${siblings.length}. Open version list.`}
          title={`Swipe v${activeIndex + 1} of ${siblings.length} — click to compare versions`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        >
          <span>
            v{activeIndex + 1}/{siblings.length}
          </span>
        </button>

        <button
          type="button"
          className="btn turn-swipe-step-btn"
          disabled={isBusy || activeIndex >= siblings.length - 1}
          aria-label="Next swipe version"
          title="Next swipe version"
          onClick={(e) => {
            e.stopPropagation();
            const next = siblings[activeIndex + 1];
            if (next) selectSibling(next.id);
          }}
        >
          <ChevronRight size={12} aria-hidden="true" />
        </button>
      </div>

      {isOpen && (
        <div
          id={popoverId}
          role="listbox"
          aria-label="Swipe versions"
          className="ui-popover turn-swipe-popover"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="turn-swipe-popover-header">
            <span className="turn-swipe-popover-title">
              Swipe Versions ({siblings.length})
            </span>
            <button
              type="button"
              className="btn btn-icon turn-swipe-popover-close"
              aria-label="Close swipe versions"
              onClick={onClose}
            >
              <X size={12} />
            </button>
          </div>

          <div className="turn-swipe-popover-list">
            {siblings.map((sib, idx) => {
              const isActive = sib.id === turn.id;
              const descCount = childCountByTurnId?.[sib.id] ?? 0;
              const { isEditedPrompt, preview } = buildSwipePreviewText(
                sib,
                firstPrompt
              );

              return (
                <button
                  key={sib.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  disabled={isBusy}
                  className={`turn-swipe-option${
                    isActive ? " turn-swipe-option--active" : ""
                  }`}
                  onClick={() => selectSibling(sib.id)}
                >
                  <div className="turn-swipe-option-top">
                    <span className="turn-swipe-version-badge">v{idx + 1}</span>
                    {isActive && (
                      <span className="turn-swipe-active-badge">Active</span>
                    )}
                    {isEditedPrompt && (
                      <span className="turn-swipe-edited-badge">Edited</span>
                    )}
                    {sib.is_bookmarked && (
                      <Bookmark
                        size={10}
                        className="turn-swipe-bookmark-icon"
                        fill="currentColor"
                        aria-label="Bookmarked"
                      />
                    )}
                    {descCount > 0 && (
                      <span
                        className="turn-swipe-branch-badge"
                        title={`${descCount} descendant continuation${
                          descCount === 1 ? "" : "s"
                        }`}
                      >
                        <GitBranch size={10} aria-hidden="true" />+{descCount}
                      </span>
                    )}
                  </div>
                  <div className="turn-swipe-option-preview">
                    {preview || "Empty turn"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
