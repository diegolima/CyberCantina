import React, { useEffect, useMemo, useState } from "react";
import { Bookmark, GitBranch, Navigation, ScrollText, Search, X } from "lucide-react";
import type { CampaignStateBundle } from "../../types";
import { BranchGraphCanvas } from "./BranchGraphCanvas";
import { countVisibleTimelines } from "./branchGraphLayout";
import {
  buildStoryBookmarkItems,
  filterStoryBookmarkItems,
} from "./storyBookmarks";

export type StoryModalTab = "summary" | "timelines" | "bookmarks";

export interface StoryModalProps {
  isOpen: boolean;
  initialTab?: StoryModalTab;
  onClose: () => void;
  bundle: CampaignStateBundle;
  memoryConfig?: { working_memory_turns: number; episodic_chunk_size: number };
  isMutatingLocked?: boolean;
  /** Optional initial selected node ID for the Branch Graph (helpful in tests). */
  initialSelectedNodeId?: string | null;
  onZoomToTurn: (turnId: string) => void;
  onSwitchTimeline: (tipTurnId: string) => Promise<void> | void;
  onBranchFromTurn: (turnId: string) => Promise<void> | void;
}

export const StoryModal: React.FC<StoryModalProps> = ({
  isOpen,
  initialTab = "summary",
  onClose,
  bundle,
  memoryConfig,
  isMutatingLocked = false,
  initialSelectedNodeId,
  onZoomToTurn,
  onSwitchTimeline,
  onBranchFromTurn,
}) => {
  const [activeTab, setActiveTab] = useState<StoryModalTab>(initialTab);
  const [bookmarkQuery, setBookmarkQuery] = useState("");
  const [focusedTimelineTurnId, setFocusedTimelineTurnId] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setFocusedTimelineTurnId(null);
      setBookmarkQuery("");
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen, onClose]);

  const timelineCount = useMemo(
    () =>
      countVisibleTimelines(
        bundle.all_turn_nodes,
        bundle.active_branch_turns,
        bundle.campaign.active_leaf_turn_id
      ),
    [
      bundle.all_turn_nodes,
      bundle.active_branch_turns,
      bundle.campaign.active_leaf_turn_id,
    ]
  );

  const locationNamesById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const loc of bundle.visible_locations ?? []) {
      map[loc.id] = loc.name;
    }
    if (bundle.active_location?.id && bundle.active_location?.name) {
      map[bundle.active_location.id] = bundle.active_location.name;
    }
    return map;
  }, [bundle.visible_locations, bundle.active_location]);

  const bookmarkItems = useMemo(
    () =>
      buildStoryBookmarkItems(
        bundle.all_turn_nodes,
        bundle.active_branch_turns,
        locationNamesById
      ),
    [bundle.all_turn_nodes, bundle.active_branch_turns, locationNamesById]
  );

  const filteredBookmarks = useMemo(
    () => filterStoryBookmarkItems(bookmarkItems, bookmarkQuery),
    [bookmarkItems, bookmarkQuery]
  );

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      style={{ zIndex: 75 }}
      role="dialog"
      aria-modal="true"
      aria-label="Campaign Story and Timelines"
    >
      <div
        className="modal-panel story-modal-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="story-modal-header">
          <div className="story-modal-title-group">
            <ScrollText size={18} color="var(--accent-amber)" />
            <div>
              <h2 className="story-modal-title">Story</h2>
              <div className="story-modal-subtitle">{bundle.campaign.name}</div>
            </div>
          </div>

          <div className="story-modal-tabs" role="tablist" aria-label="Story categories">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "summary"}
              className={`story-modal-tab ${activeTab === "summary" ? "active" : ""}`}
              onClick={() => setActiveTab("summary")}
            >
              <ScrollText size={14} />
              <span>Summary</span>
              {bundle.episodic_chunks.length > 0 && (
                <span className="story-modal-tab-count">
                  {bundle.episodic_chunks.length}
                </span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "timelines"}
              className={`story-modal-tab ${activeTab === "timelines" ? "active" : ""}`}
              onClick={() => {
                setFocusedTimelineTurnId(null);
                setActiveTab("timelines");
              }}
            >
              <GitBranch size={14} />
              <span>Timelines</span>
              {timelineCount > 0 && (
                <span className="story-modal-tab-count">{timelineCount}</span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "bookmarks"}
              className={`story-modal-tab story-modal-tab--bookmarks ${
                activeTab === "bookmarks" ? "active" : ""
              }`}
              onClick={() => setActiveTab("bookmarks")}
            >
              <Bookmark size={14} />
              <span>Bookmarks</span>
              {bookmarkItems.length > 0 && (
                <span className="story-modal-tab-count">{bookmarkItems.length}</span>
              )}
            </button>
          </div>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            aria-label="Close Story modal"
            title="Close"
            style={{ padding: "6px" }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="story-modal-body">
          {activeTab === "summary" ? (
            <div className="story-summary-panel" role="tabpanel" aria-label="Story Summary">
              <div className="story-summary-scope-note">
                Showing condensed episodic summaries for the{" "}
                <strong>currently active timeline branch</strong> (
                {bundle.active_branch_turns.length}{" "}
                {bundle.active_branch_turns.length === 1 ? "turn" : "turns"}).
              </div>
              {bundle.episodic_chunks.length === 0 ? (
                <div className="inspector-empty ui-empty-state ui-empty-state--dashed-dark">
                  No summaries yet.
                  {memoryConfig &&
                    ` Once the story exceeds ${memoryConfig.working_memory_turns} turns, the oldest ${memoryConfig.episodic_chunk_size} are condensed into a summary here.`}
                </div>
              ) : (
                <div className="story-summary-list">
                  {bundle.episodic_chunks.map((chunk) => (
                    <div key={chunk.id} className="story-chunk">
                      <div className="story-chunk-range">
                        Turns {chunk.start_turn_depth}–{chunk.end_turn_depth}
                      </div>
                      {chunk.summary_text}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : activeTab === "bookmarks" ? (
            <div
              className="story-bookmarks-panel"
              role="tabpanel"
              aria-label="Bookmarked Turns"
            >
              <div className="ui-search-bar ui-search-bar--purple">
                <Search size={14} color="var(--accent-purple, #c084fc)" />
                <input
                  type="text"
                  className="ui-search-bar-input"
                  value={bookmarkQuery}
                  onChange={(e) => setBookmarkQuery(e.target.value)}
                  placeholder="Filter bookmarks by note keywords..."
                  aria-label="Filter bookmarks by note keywords"
                />
                {bookmarkQuery && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ padding: "2px 6px" }}
                    onClick={() => setBookmarkQuery("")}
                    aria-label="Clear bookmark search"
                    title="Clear search"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {bookmarkItems.length === 0 ? (
                <div className="inspector-empty ui-empty-state ui-empty-state--dashed-dark">
                  No bookmarked turns yet. Click the bookmark icon on the top-left corner
                  of any turn card after Turn #0 to save key moments and add personal notes.
                </div>
              ) : filteredBookmarks.length === 0 ? (
                <div className="inspector-empty ui-empty-state ui-empty-state--dashed-dark">
                  No bookmarked notes match &ldquo;{bookmarkQuery.trim()}&rdquo;.
                </div>
              ) : (
                <div className="story-bookmarks-list">
                  {filteredBookmarks.map((item) => (
                    <button
                      key={item.turn.id}
                      type="button"
                      className={`story-bookmark-card ${
                        item.isOnActiveTimeline
                          ? "story-bookmark-card--active"
                          : "story-bookmark-card--alt"
                      }`}
                      data-bookmark-item-id={item.turn.id}
                      onClick={() => {
                        if (item.isOnActiveTimeline) {
                          onZoomToTurn(item.turn.id);
                        } else {
                          setFocusedTimelineTurnId(item.turn.id);
                          setActiveTab("timelines");
                        }
                      }}
                    >
                      <div className="story-bookmark-card-head">
                        <div className="story-bookmark-card-title-group">
                          <Bookmark
                            size={13}
                            color="var(--accent-purple, #c084fc)"
                            fill="currentColor"
                          />
                          <strong>Turn #{item.turn.depth_index}</strong>
                          {item.swipeIndex !== null && (
                            <span className="story-bookmark-swipe-pill">
                              v{item.swipeIndex}
                            </span>
                          )}
                          <span
                            className={`branch-graph-status-pill ${
                              item.isOnActiveTimeline
                                ? "status-active"
                                : "status-tip"
                            }`}
                          >
                            {item.isOnActiveTimeline
                              ? "Active Timeline"
                              : item.swipeIndex !== null
                              ? "Alternate Swipe"
                              : "Alternate Branch"}
                          </span>
                        </div>
                        <span className="story-bookmark-card-action-hint">
                          {item.isOnActiveTimeline ? (
                            <>
                              <Navigation size={11} />
                              <span>Jump to moment</span>
                            </>
                          ) : (
                            <>
                              <GitBranch size={11} />
                              <span>Focus in Timelines</span>
                            </>
                          )}
                        </span>
                      </div>

                      <div className="story-bookmark-card-meta">
                        <span>{item.locationName}</span>
                        <span>• {item.turn.world_snapshot.world_timestamp}</span>
                      </div>

                      {item.notableSummary && (
                        <div className="story-bookmark-notable-line">
                          ★ {item.notableSummary}
                        </div>
                      )}

                      {item.noteText && (
                        <div className="story-bookmark-note-pill">
                          <Bookmark size={12} fill="currentColor" style={{ flexShrink: 0 }} />
                          <span>{item.noteText}</span>
                        </div>
                      )}

                      <div className="story-bookmark-preview">
                        {item.fallbackPreview}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="story-timelines-panel" role="tabpanel" aria-label="Branch Graph">
              <BranchGraphCanvas
                bundle={bundle}
                isMutatingLocked={isMutatingLocked}
                initialSelectedNodeId={focusedTimelineTurnId ?? initialSelectedNodeId}
                focusSelectedOnMount={Boolean(focusedTimelineTurnId)}
                onZoomToTurn={onZoomToTurn}
                onSwitchTimeline={onSwitchTimeline}
                onBranchFromTurn={onBranchFromTurn}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
