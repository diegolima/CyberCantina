import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Compass,
  FolderOpen,
  LayoutGrid,
  Save,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import type { LocationContainer, LocationNode } from "../../types";
import type { ProjectedDepthTopology } from "./topologyProjection";
import {
  type MapSearchMatch,
  filterAndRankMapSearchResults,
} from "./mapSearch";
import { SplitSaveButton } from "../shared/SplitSaveButton";

export interface TopologyHeaderToolbarProps {
  title?: string;
  locationsCount: number;
  edgesCount: number;
  containersCount: number;
  onReimagineMap?: () => void;
  hasSaveMap: boolean;
  effectiveDirty: boolean;
  hasBlockingErrors: boolean;
  effectiveSaving: boolean;
  isMutatingLocked: boolean;
  validationSummary: string | null;
  handleSaveClick: () => Promise<boolean> | void;
  handleSaveAndCloseClick?: () => Promise<void> | void;
  onClose?: () => void;
  handleCloseClick: () => void;
  currentContainerId: string | null;
  projectedTopology: ProjectedDepthTopology;
  drillIntoContainer: (contId: string | null) => void;
  searchLocations?: readonly LocationNode[];
  searchContainers?: readonly LocationContainer[];
  activeLocationId?: string;
  onFocusSearchResult?: (match: MapSearchMatch) => void;
  isMobileViewport?: boolean;
  canAutoLayout?: boolean;
  autoLayoutDisabled?: boolean;
  isAutoLayoutPreviewing?: boolean;
  onPreviewAutoLayout?: () => void;
  consistencyIssueCount?: number;
  consistencyErrorCount?: number;
  isConsistencyPanelOpen?: boolean;
  onToggleConsistencyPanel?: () => void;
  consistencyPopover?: React.ReactNode;
}

export const TopologyHeaderToolbar: React.FC<TopologyHeaderToolbarProps> = ({
  title,
  locationsCount,
  edgesCount,
  containersCount,
  onReimagineMap,
  hasSaveMap,
  effectiveDirty,
  hasBlockingErrors,
  effectiveSaving,
  isMutatingLocked,
  validationSummary,
  handleSaveClick,
  handleSaveAndCloseClick,
  onClose,
  handleCloseClick,
  currentContainerId,
  projectedTopology,
  drillIntoContainer,
  searchLocations = [],
  searchContainers = [],
  activeLocationId,
  onFocusSearchResult,
  isMobileViewport = false,
  canAutoLayout = false,
  autoLayoutDisabled = false,
  isAutoLayoutPreviewing = false,
  onPreviewAutoLayout,
  consistencyIssueCount = 0,
  consistencyErrorCount = 0,
  isConsistencyPanelOpen = false,
  onToggleConsistencyPanel,
  consistencyPopover = null,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();

  const headerTitle =
    title ||
    `Spatial Topology (${locationsCount} Locations, ${edgesCount} Passages)`;

  const searchMatches = useMemo(
    () =>
      onFocusSearchResult
        ? filterAndRankMapSearchResults({
            query: searchQuery,
            locations: searchLocations,
            containers: searchContainers,
          })
        : [],
    [onFocusSearchResult, searchQuery, searchLocations, searchContainers]
  );

  const hasQuery = searchQuery.trim().length > 0;
  const showDropdown = Boolean(onFocusSearchResult && isDropdownOpen && hasQuery);
  const clampedHighlight =
    searchMatches.length > 0
      ? Math.max(0, Math.min(highlightedIndex, searchMatches.length - 1))
      : -1;

  useEffect(() => {
    if (!showDropdown) return;
    const handleOutsideMouseDown = (e: MouseEvent) => {
      if (
        searchWrapRef.current &&
        !searchWrapRef.current.contains(e.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideMouseDown);
    return () =>
      document.removeEventListener("mousedown", handleOutsideMouseDown);
  }, [showDropdown]);

  useEffect(() => {
    if (!showDropdown || clampedHighlight < 0) return;
    const optEl = optionRefs.current[clampedHighlight];
    if (optEl && typeof optEl.scrollIntoView === "function") {
      optEl.scrollIntoView({ block: "nearest" });
    }
  }, [showDropdown, clampedHighlight]);

  useEffect(() => {
    if (mobileSearchOpen && isMobileViewport) {
      searchInputRef.current?.focus();
    }
  }, [mobileSearchOpen, isMobileViewport]);

  const commitMatch = (match: MapSearchMatch) => {
    if (!onFocusSearchResult) return;
    onFocusSearchResult(match);
    setSearchQuery("");
    setIsDropdownOpen(false);
    setMobileSearchOpen(false);
    setHighlightedIndex(0);
    searchInputRef.current?.blur();
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      if (!hasQuery) return;
      e.preventDefault();
      if (!isDropdownOpen) {
        setIsDropdownOpen(true);
        setHighlightedIndex(0);
        return;
      }
      if (searchMatches.length > 0) {
        setHighlightedIndex((prev) => (prev + 1) % searchMatches.length);
      }
      return;
    }

    if (e.key === "ArrowUp") {
      if (!hasQuery) return;
      e.preventDefault();
      if (!isDropdownOpen) {
        setIsDropdownOpen(true);
        setHighlightedIndex(Math.max(0, searchMatches.length - 1));
        return;
      }
      if (searchMatches.length > 0) {
        setHighlightedIndex(
          (prev) => (prev - 1 + searchMatches.length) % searchMatches.length
        );
      }
      return;
    }

    if (e.key === "Enter") {
      if (!hasQuery || searchMatches.length === 0) return;
      e.preventDefault();
      const chosen =
        searchMatches[clampedHighlight >= 0 ? clampedHighlight : 0];
      if (chosen) {
        commitMatch(chosen);
      }
      return;
    }

    if (e.key === "Escape") {
      if (isDropdownOpen || searchQuery.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        setIsDropdownOpen(false);
        setSearchQuery("");
        setHighlightedIndex(0);
        searchInputRef.current?.blur();
      }
    }
  };

  const activeDescendantId =
    showDropdown && clampedHighlight >= 0 && searchMatches[clampedHighlight]
      ? `${listboxId}-opt-${clampedHighlight}`
      : undefined;

  const renderSearchBox = () =>
    onFocusSearchResult ? (
      <div className="ui-search-wrap ui-search-wrap--map" ref={searchWrapRef}>
        <Search size={13} className="ui-search-icon" aria-hidden="true" />
        <input
          ref={searchInputRef}
          type="text"
          className="ui-search-input ui-search-input--card ui-search-input--cyan"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={showDropdown ? listboxId : undefined}
          aria-activedescendant={activeDescendantId}
          aria-autocomplete="list"
          aria-label="Search locations and containers"
          placeholder="Search locations & areas…"
          value={searchQuery}
          onFocus={() => {
            if (searchQuery.trim().length > 0) {
              setIsDropdownOpen(true);
            }
          }}
          onBlur={(e) => {
            const nextTarget = e.relatedTarget as Node | null;
            if (nextTarget && searchWrapRef.current?.contains(nextTarget)) {
              return;
            }
            setIsDropdownOpen(false);
          }}
          onChange={(e) => {
            const next = e.target.value;
            setSearchQuery(next);
            setHighlightedIndex(0);
            setIsDropdownOpen(next.trim().length > 0);
          }}
          onKeyDown={handleSearchKeyDown}
        />
        {searchQuery.length > 0 && (
          <button
            type="button"
            className="ui-search-clear"
            aria-label="Clear map search"
            title="Clear search"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setSearchQuery("");
              setIsDropdownOpen(false);
              setHighlightedIndex(0);
              searchInputRef.current?.focus();
            }}
          >
            <X size={12} />
          </button>
        )}

        {showDropdown && (
          <div
            id={listboxId}
            role="listbox"
            aria-label="Matching locations and containers"
            className="ui-popover map-search-dropdown"
          >
            {searchMatches.length === 0 ? (
              <div className="ui-empty-state ui-empty-state--compact">
                No matching locations or containers
              </div>
            ) : (
              searchMatches.map((match, idx) => {
                const isHighlighted = idx === clampedHighlight;
                const isActiveLoc =
                  match.kind === "location" && match.id === activeLocationId;
                const isCurrentCont =
                  match.kind === "container" && match.id === currentContainerId;
                return (
                  <button
                    key={match.key}
                    id={`${listboxId}-opt-${idx}`}
                    ref={(el) => {
                      optionRefs.current[idx] = el;
                    }}
                    type="button"
                    role="option"
                    aria-selected={isHighlighted}
                    data-map-search-option={match.id}
                    data-map-search-kind={match.kind}
                    className={`map-search-item${
                      isHighlighted ? " map-search-item--active" : ""
                    }`}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => commitMatch(match)}
                  >
                    <div className="map-search-item-top">
                      <span className="map-search-item-name">{match.name}</span>
                      <span className="map-search-item-badges">
                        {isActiveLoc && (
                          <span className="map-search-status">Active</span>
                        )}
                        {!isActiveLoc && match.isStarting && (
                          <span className="map-search-status">Start</span>
                        )}
                        {isCurrentCont && (
                          <span className="map-search-status">Inside</span>
                        )}
                        <span
                          className={`map-search-badge map-search-badge--${
                            match.kind === "container"
                              ? "container"
                              : match.isHub
                              ? "hub"
                              : "location"
                          }`}
                          title={
                            match.kind === "container"
                              ? match.depthLabel
                              : match.isHub
                              ? "Transit Hub"
                              : "Location"
                          }
                        >
                          {match.kind === "container"
                            ? `L${match.containerDepth}`
                            : match.isHub
                            ? "Hub"
                            : "Location"}
                        </span>
                      </span>
                    </div>
                    <div className="map-search-item-breadcrumb">
                      {match.breadcrumb}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    ) : null;

  return (
    <>
      {/* Unified Header Toolbar */}
      <div className="map-toolbar">
        <span title={headerTitle} className="map-toolbar-title">
          <Compass size={17} color="var(--accent-cyan)" style={{ flexShrink: 0 }} />
          <span className="map-toolbar-title-text">{headerTitle}</span>
        </span>

        <div className="map-toolbar-actions">
          {!isMobileViewport && renderSearchBox()}

          {isMobileViewport && onFocusSearchResult && (
            <button
              type="button"
              className={`btn map-toolbar-icon-btn${mobileSearchOpen ? " active" : ""}`}
              aria-label="Toggle map search"
              aria-expanded={mobileSearchOpen}
              title="Search locations & areas"
              onClick={() => setMobileSearchOpen((v) => !v)}
            >
              <Search size={15} />
            </button>
          )}

          {onToggleConsistencyPanel && (
            <div className="map-consistency-trigger-wrap">
              <button
                type="button"
                className={`btn ${
                  isMobileViewport ? "map-toolbar-icon-btn" : "map-toolbar-action-btn"
                }${isConsistencyPanelOpen ? " active" : ""}${
                  consistencyErrorCount > 0
                    ? " map-consistency-btn--error"
                    : consistencyIssueCount > 0
                    ? " map-consistency-btn--warn"
                    : ""
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleConsistencyPanel();
                }}
                title={
                  consistencyIssueCount > 0
                    ? `${consistencyIssueCount} spatial distance consistency issue(s) — click to inspect & reconcile`
                    : "Spatial distance consistency — all distances aligned"
                }
                aria-label="Spatial Distance Consistency"
                aria-expanded={isConsistencyPanelOpen}
                data-testid="map-consistency-btn"
              >
                {consistencyIssueCount > 0 ? (
                  <AlertTriangle
                    size={isMobileViewport ? 15 : 13}
                    color={consistencyErrorCount > 0 ? "#fb7185" : "#fbbf24"}
                  />
                ) : (
                  <CheckCircle2 size={isMobileViewport ? 15 : 13} color="#34d399" />
                )}
                {!isMobileViewport && (
                  <span className="map-toolbar-btn-label">Consistency</span>
                )}
                {consistencyIssueCount > 0 && (
                  <span className="map-consistency-count-pill">
                    {consistencyIssueCount}
                  </span>
                )}
              </button>
              {consistencyPopover}
            </div>
          )}

          {canAutoLayout && onPreviewAutoLayout && (
            <button
              type="button"
              className={`btn ${
                isMobileViewport ? "map-toolbar-icon-btn" : "map-toolbar-action-btn"
              }${isAutoLayoutPreviewing ? " active" : ""}`}
              disabled={autoLayoutDisabled || effectiveSaving}
              onClick={onPreviewAutoLayout}
              title={
                autoLayoutDisabled
                  ? "Add at least 2 elements in this view to auto-layout"
                  : isAutoLayoutPreviewing
                  ? "Auto-layout preview active (Apply or Reset on canvas)"
                  : "Preview auto-layout for current view"
              }
              aria-label="Auto-Layout Current View"
              aria-pressed={isAutoLayoutPreviewing}
              data-testid="map-auto-layout-btn"
            >
              <LayoutGrid size={isMobileViewport ? 15 : 13} />
              {!isMobileViewport && (
                <span className="map-toolbar-btn-label">Auto-Layout</span>
              )}
            </button>
          )}

          {onReimagineMap && (
            <button
              type="button"
              className="btn btn-purple map-toolbar-action-btn"
              onClick={onReimagineMap}
              title="Re-imagine Map with AI"
              aria-label="Re-imagine Map"
            >
              <Sparkles size={13} />
              <span className="map-toolbar-btn-label">Re-imagine Map</span>
            </button>
          )}

          {hasSaveMap && (!isMobileViewport || !isMutatingLocked) && (
            <SplitSaveButton
              variantClass={
                effectiveDirty && !hasBlockingErrors ? "btn-amber" : "btn-cyan"
              }
              buttonClassName="map-toolbar-action-btn"
              disabled={
                !effectiveDirty ||
                hasBlockingErrors ||
                effectiveSaving ||
                isMutatingLocked
              }
              title={
                hasBlockingErrors
                  ? validationSummary || "Resolve unlinked nodes before saving."
                  : !effectiveDirty
                  ? "No unsaved map changes"
                  : "Persist map layout and structure"
              }
              menuDirection="down"
              menuAlign="right"
              testId="map-save-btn"
              onSave={handleSaveClick}
              onSaveAndClose={handleSaveAndCloseClick}
              label={
                effectiveSaving ? (
                  <>Saving...</>
                ) : effectiveDirty ? (
                  <>
                    <Save size={13} />
                    <span className="map-toolbar-btn-label">Save Map</span>
                  </>
                ) : (
                  <>
                    <Check size={13} />
                    <span className="map-toolbar-btn-label">Map Saved</span>
                  </>
                )
              }
            />
          )}

          {onClose && (
            <button
              type="button"
              className="btn map-toolbar-close-btn"
              onClick={handleCloseClick}
              title="Close Map"
              aria-label="Close Map"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Expandable Mobile Search Row */}
      {isMobileViewport && mobileSearchOpen && onFocusSearchResult && (
        <div className="map-toolbar-search-row">{renderSearchBox()}</div>
      )}

      {/* Container Breadcrumbs (also acts as drag-drop target to move items outward) */}
      {(containersCount > 0 || currentContainerId) && (
        <div
          aria-label="Container hierarchy breadcrumbs"
          className="map-breadcrumbs"
        >
          <button
            type="button"
            className="btn"
            data-breadcrumb-drop="__root__"
            onClick={() => drillIntoContainer(null)}
            style={{
              padding: "2px 8px",
              fontSize: "0.72rem",
              borderColor:
                currentContainerId === null
                  ? "var(--accent-cyan)"
                  : "var(--border-subtle)",
              color:
                currentContainerId === null
                  ? "var(--accent-cyan)"
                  : "var(--text-secondary)",
            }}
          >
            World Root
          </button>

          {projectedTopology.breadcrumbs.map((crumb, idx) => {
            const isLeaf = idx === projectedTopology.breadcrumbs.length - 1;
            return (
              <React.Fragment key={crumb.id}>
                <ChevronRight size={13} color="var(--text-muted)" />
                <button
                  type="button"
                  className="btn"
                  data-breadcrumb-drop={crumb.id}
                  onClick={() => drillIntoContainer(crumb.id)}
                  style={{
                    padding: "2px 8px",
                    fontSize: "0.72rem",
                    borderColor: isLeaf
                      ? "var(--accent-amber)"
                      : "var(--border-subtle)",
                    color: isLeaf
                      ? "var(--accent-amber)"
                      : "var(--text-secondary)",
                  }}
                >
                  <FolderOpen size={11} style={{ marginRight: 4 }} />
                  {crumb.name} (L{crumb.depth})
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </>
  );
};
