import React, { useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  ChevronDown,
  ChevronRight,
  GitBranch,
  Globe,
  Landmark,
  MapPin,
  Navigation,
  Pencil,
  ScrollText,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type {
  CampaignMajorEventUpdatePayload,
  CampaignStateBundle,
  MechanicsTopicId,
} from "../../types";
import { MechanicsHelpButton } from "../shared/MechanicsHelpButton";
import { TagChipsInput, normalizeTagList } from "../TagChipsInput";
import { BranchGraphCanvas } from "./BranchGraphCanvas";
import { countVisibleTimelines } from "./branchGraphLayout";
import {
  buildStoryBookmarkItems,
  filterStoryBookmarkItems,
} from "./storyBookmarks";
import {
  buildStoryMajorEvents,
  type StoryMajorEventItem,
} from "./storyMajorEvents";

export type StoryModalTab = "summary" | "major_events" | "timelines" | "bookmarks";

const STORY_TAB_HELP: Record<
  StoryModalTab,
  { topicId: MechanicsTopicId; label: string }
> = {
  summary: {
    topicId: "memory-3-tier",
    label: "How the AI Remembers (3-Tier Memory)",
  },
  major_events: {
    topicId: "timelines-major-events",
    label: "Major Events & Copy-on-Write",
  },
  timelines: {
    topicId: "timelines-branching",
    label: "Branching, Swiping & Editing",
  },
  bookmarks: {
    topicId: "timelines-graph-bookmarks",
    label: "Branch Graph & Bookmarks",
  },
};

export interface StoryModalProps {
  isOpen: boolean;
  initialTab?: StoryModalTab;
  onClose: () => void;
  bundle: CampaignStateBundle;
  memoryConfig?: { working_memory_turns: number; episodic_chunk_size: number };
  isMutatingLocked?: boolean;
  /** Optional initial selected node ID for the Branch Graph (helpful in tests). */
  initialSelectedNodeId?: string | null;
  /** Optional initial expanded Major Event key (helpful in tests). */
  initialExpandedMajorEventKey?: string | null;
  onZoomToTurn: (turnId: string) => void;
  onSwitchTimeline: (tipTurnId: string) => Promise<void> | void;
  onBranchFromTurn: (turnId: string) => Promise<void> | void;
  onUpdateMajorEvent?: (
    turnId: string,
    payload: CampaignMajorEventUpdatePayload
  ) => Promise<void> | void;
  onDeleteMajorEvent?: (turnId: string) => Promise<void> | void;
  onOpenMechanicsHelp?: (topicId: MechanicsTopicId) => void;
}

export const StoryModal: React.FC<StoryModalProps> = ({
  isOpen,
  initialTab = "summary",
  onClose,
  bundle,
  memoryConfig,
  isMutatingLocked = false,
  initialSelectedNodeId,
  initialExpandedMajorEventKey = null,
  onZoomToTurn,
  onSwitchTimeline,
  onBranchFromTurn,
  onUpdateMajorEvent,
  onDeleteMajorEvent,
  onOpenMechanicsHelp,
}) => {
  const [activeTab, setActiveTab] = useState<StoryModalTab>(initialTab);
  const [bookmarkQuery, setBookmarkQuery] = useState("");
  const [focusedTimelineTurnId, setFocusedTimelineTurnId] = useState<string | null>(
    null
  );
  const [expandedMajorEventKey, setExpandedMajorEventKey] = useState<string | null>(
    initialExpandedMajorEventKey
  );
  const [editingEventKey, setEditingEventKey] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [editKeywords, setEditKeywords] = useState<string[]>([]);
  const [editPendingKwDraft, setEditPendingKwDraft] = useState("");
  const [editLocDescription, setEditLocDescription] = useState("");
  const [editLocTags, setEditLocTags] = useState<string[]>([]);
  const [editPendingLocTagDraft, setEditPendingLocTagDraft] = useState("");
  const [majorEventError, setMajorEventError] = useState<string | null>(null);
  const [busyMajorEventKey, setBusyMajorEventKey] = useState<string | null>(null);

  const unlockLore = Boolean(bundle.campaign.world_settings?.unlock_lore);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setFocusedTimelineTurnId(null);
      setBookmarkQuery("");
      setExpandedMajorEventKey(initialExpandedMajorEventKey);
      setEditingEventKey(null);
      setMajorEventError(null);
    }
  }, [isOpen, initialTab, initialExpandedMajorEventKey]);

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

  const majorEvents = useMemo(() => buildStoryMajorEvents(bundle), [bundle]);

  const startEditingMajorEvent = (item: StoryMajorEventItem) => {
    setExpandedMajorEventKey(item.key);
    setEditingEventKey(item.key);
    setEditTitle(item.title);
    setEditSummary(item.summary);
    setEditKeywords([...item.keywords]);
    setEditPendingKwDraft("");
    setEditLocDescription(item.updatedDescription ?? "");
    setEditLocTags([...item.currentLocationTags]);
    setEditPendingLocTagDraft("");
    setMajorEventError(null);
  };

  const handleSaveMajorEvent = async (item: StoryMajorEventItem) => {
    if (!onUpdateMajorEvent || !item.turnId || busyMajorEventKey) return;
    const cleanTitle = editTitle.trim();
    const cleanSummary = editSummary.trim();
    const pendingKws = editPendingKwDraft
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const mergedKws = normalizeTagList(editKeywords, pendingKws);
    if (!cleanTitle) {
      setMajorEventError("Event title is required.");
      return;
    }
    if (!cleanSummary) {
      setMajorEventError("Event details are required.");
      return;
    }
    const payload: CampaignMajorEventUpdatePayload = {
      title: cleanTitle,
      summary: cleanSummary,
      keywords: mergedKws,
    };
    if (item.scope === "location") {
      const pendingLocTags = editPendingLocTagDraft
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      payload.updated_description = editLocDescription.trim() || null;
      payload.environmental_tags = normalizeTagList(editLocTags, pendingLocTags);
    }
    setBusyMajorEventKey(item.key);
    setMajorEventError(null);
    try {
      await onUpdateMajorEvent(item.turnId, payload);
      setEditingEventKey(null);
    } catch (err) {
      setMajorEventError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyMajorEventKey(null);
    }
  };

  const handleDeleteMajorEvent = async (item: StoryMajorEventItem) => {
    if (!onDeleteMajorEvent || !item.turnId || busyMajorEventKey) return;
    setBusyMajorEventKey(item.key);
    setMajorEventError(null);
    try {
      await onDeleteMajorEvent(item.turnId);
      if (editingEventKey === item.key) setEditingEventKey(null);
      if (expandedMajorEventKey === item.key) setExpandedMajorEventKey(null);
    } catch (err) {
      setMajorEventError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyMajorEventKey(null);
    }
  };

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
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <h2 className="story-modal-title">Story</h2>
                <MechanicsHelpButton
                  topicId={STORY_TAB_HELP[activeTab].topicId}
                  label={STORY_TAB_HELP[activeTab].label}
                  onOpenHelp={onOpenMechanicsHelp}
                />
              </div>
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
              aria-selected={activeTab === "major_events"}
              className={`story-modal-tab ${
                activeTab === "major_events" ? "active" : ""
              }`}
              onClick={() => setActiveTab("major_events")}
            >
              <Landmark size={14} />
              <span>Major Events</span>
              {majorEvents.length > 0 && (
                <span className="story-modal-tab-count">{majorEvents.length}</span>
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
          ) : activeTab === "major_events" ? (
            <div
              className="story-major-events-panel"
              role="tabpanel"
              aria-label="Major Events"
            >
              <div className="story-summary-scope-note">
                Showing major world and location events for the{" "}
                <strong>currently active timeline branch</strong> in chronological order.
                {unlockLore && (
                  <span className="story-gm-inline-badge">GM Mode Active — Edit/Remove enabled</span>
                )}
              </div>

              {majorEventError && (
                <div className="story-major-event-error">{majorEventError}</div>
              )}

              {majorEvents.length === 0 ? (
                <div className="inspector-empty ui-empty-state ui-empty-state--dashed-dark">
                  No major world-changing or location-changing events have been recorded on this timeline yet.
                </div>
              ) : (
                <div className="story-major-events-list">
                  {majorEvents.map((item) => {
                    const isExpanded = expandedMajorEventKey === item.key;
                    const isEditing = editingEventKey === item.key;
                    const isBusy = busyMajorEventKey === item.key;
                    return (
                      <div
                        key={item.key}
                        className={`story-major-event-card ${
                          isExpanded ? "is-expanded" : ""
                        }`}
                        data-major-event-turn-id={item.turnId}
                      >
                        <button
                          type="button"
                          className="story-major-event-header"
                          aria-expanded={isExpanded}
                          onClick={() => {
                            if (isEditing) return;
                            setExpandedMajorEventKey(isExpanded ? null : item.key);
                          }}
                        >
                          <span className="story-major-event-title-wrap">
                            {isExpanded ? (
                              <ChevronDown size={14} color="var(--accent-amber)" />
                            ) : (
                              <ChevronRight size={14} color="var(--text-muted)" />
                            )}
                            <span className="story-major-event-title">{item.title}</span>
                          </span>
                          <span className="story-major-event-badges">
                            <span
                              className={`badge ${
                                item.scope === "world"
                                  ? "codex-badge--amber"
                                  : "codex-badge--location"
                              }`}
                            >
                              {item.scope === "world" ? (
                                <>
                                  <Globe size={10} /> World
                                </>
                              ) : (
                                <>
                                  <MapPin size={10} /> {item.locationName || "Location"}
                                </>
                              )}
                            </span>
                            {item.turnDepthIndex > 0 && (
                              <span className="badge codex-badge--muted">
                                Turn #{item.turnDepthIndex}
                              </span>
                            )}
                          </span>
                        </button>

                        {isExpanded && (
                          <div className="story-major-event-body">
                            {isEditing ? (
                              <div className="story-major-event-edit-form">
                                <input
                                  className="field-input"
                                  value={editTitle}
                                  disabled={isBusy || isMutatingLocked}
                                  placeholder="YYYY-MM-DD - Evocative title"
                                  onChange={(e) => setEditTitle(e.target.value)}
                                />
                                <textarea
                                  className="field-textarea"
                                  rows={3}
                                  value={editSummary}
                                  disabled={isBusy || isMutatingLocked}
                                  placeholder="Major event summary..."
                                  onChange={(e) => setEditSummary(e.target.value)}
                                />
                                <TagChipsInput
                                  value={editKeywords}
                                  onChange={setEditKeywords}
                                  onDraftChange={setEditPendingKwDraft}
                                  disabled={isBusy || isMutatingLocked}
                                  placeholder="Add keywords..."
                                  accentVariant="amber"
                                />
                                {item.scope === "location" && (
                                  <>
                                    <label className="story-major-event-field-label">
                                      Updated Location Description
                                    </label>
                                    <textarea
                                      className="field-textarea"
                                      rows={3}
                                      value={editLocDescription}
                                      disabled={isBusy || isMutatingLocked}
                                      placeholder="Revised location description..."
                                      onChange={(e) => setEditLocDescription(e.target.value)}
                                    />
                                    <label className="story-major-event-field-label">
                                      Location Environmental Tags
                                    </label>
                                    <TagChipsInput
                                      value={editLocTags}
                                      onChange={setEditLocTags}
                                      onDraftChange={setEditPendingLocTagDraft}
                                      disabled={isBusy || isMutatingLocked}
                                      placeholder="Environmental tags..."
                                      accentVariant="cyan"
                                    />
                                  </>
                                )}
                                <div className="story-major-event-actions">
                                  <button
                                    type="button"
                                    className="btn btn-sm"
                                    disabled={isBusy}
                                    onClick={() => {
                                      setEditingEventKey(null);
                                      setMajorEventError(null);
                                    }}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-amber btn-sm"
                                    disabled={isBusy || isMutatingLocked}
                                    onClick={() => handleSaveMajorEvent(item)}
                                  >
                                    {isBusy ? "Saving..." : "Save Changes"}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <p className="story-major-event-summary">{item.summary}</p>
                                {item.scope === "world" && item.locationName && (
                                  <div className="story-major-event-location-ref">
                                    <MapPin size={11} /> Occurred at: <strong>{item.locationName}</strong>
                                  </div>
                                )}
                                {item.scope === "location" && item.updatedDescription && (
                                  <div className="story-major-event-loc-change">
                                    <div className="story-major-event-loc-change-label">
                                      Updated Location Description ({item.locationName || "Location"})
                                    </div>
                                    <p>{item.updatedDescription}</p>
                                    {(item.tagsAdded.length > 0 || item.tagsRemoved.length > 0) && (
                                      <div className="codex-chip-list">
                                        {item.tagsAdded.map((t) => (
                                          <span key={`add-${t}`} className="badge codex-badge--emerald">
                                            +{t}
                                          </span>
                                        ))}
                                        {item.tagsRemoved.map((t) => (
                                          <span key={`rem-${t}`} className="badge codex-badge--muted">
                                            -{t}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                                {item.keywords.length > 0 && (
                                  <div className="codex-chip-list">
                                    {item.keywords.map((kw) => (
                                      <span key={kw} className="badge codex-tag-chip">
                                        {kw}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <div className="story-major-event-actions">
                                  {item.turnId && (
                                    <button
                                      type="button"
                                      className="btn btn-sm"
                                      onClick={() => onZoomToTurn(item.turnId)}
                                    >
                                      <Navigation size={11} /> Jump to Turn #{item.turnDepthIndex}
                                    </button>
                                  )}
                                  {unlockLore && !isMutatingLocked && item.turnId && (
                                    <div style={{ display: "inline-flex", gap: 6, marginLeft: "auto" }}>
                                      {onUpdateMajorEvent && (
                                        <button
                                          type="button"
                                          className="btn btn-sm"
                                          disabled={isBusy}
                                          onClick={() => startEditingMajorEvent(item)}
                                        >
                                          <Pencil size={11} /> Edit
                                        </button>
                                      )}
                                      {onDeleteMajorEvent && (
                                        <button
                                          type="button"
                                          className="btn btn-sm story-major-event-delete-btn"
                                          disabled={isBusy}
                                          onClick={() => handleDeleteMajorEvent(item)}
                                        >
                                          <Trash2 size={11} />{" "}
                                          {item.scope === "location" ? "Delete & Revert" : "Delete"}
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
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
