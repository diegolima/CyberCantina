import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Compass,
  Crosshair,
  FolderOpen,
  Save,
  Search,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { LocationContainer, LocationNode } from "../../types";
import type { ProjectedDepthTopology } from "./topologyProjection";
import { MAX_MAP_ZOOM, MIN_MAP_ZOOM, clampZoom } from "./mapGeometry";
import {
  type MapSearchMatch,
  filterAndRankMapSearchResults,
} from "./mapSearch";

export interface TopologyHeaderToolbarProps {
  title?: string;
  locationsCount: number;
  edgesCount: number;
  containersCount: number;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  handleCenter: () => void;
  onReimagineMap?: () => void;
  hasSaveMap: boolean;
  effectiveDirty: boolean;
  hasBlockingErrors: boolean;
  effectiveSaving: boolean;
  isMutatingLocked: boolean;
  validationSummary: string | null;
  handleSaveClick: () => void;
  onClose?: () => void;
  handleCloseClick: () => void;
  currentContainerId: string | null;
  projectedTopology: ProjectedDepthTopology;
  drillIntoContainer: (contId: string | null) => void;
  searchLocations?: readonly LocationNode[];
  searchContainers?: readonly LocationContainer[];
  activeLocationId?: string;
  onFocusSearchResult?: (match: MapSearchMatch) => void;
}

export const TopologyHeaderToolbar: React.FC<TopologyHeaderToolbarProps> = ({
  title,
  locationsCount,
  edgesCount,
  containersCount,
  zoom,
  setZoom,
  handleCenter,
  onReimagineMap,
  hasSaveMap,
  effectiveDirty,
  hasBlockingErrors,
  effectiveSaving,
  isMutatingLocked,
  validationSummary,
  handleSaveClick,
  onClose,
  handleCloseClick,
  currentContainerId,
  projectedTopology,
  drillIntoContainer,
  searchLocations = [],
  searchContainers = [],
  activeLocationId,
  onFocusSearchResult,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
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

  const commitMatch = (match: MapSearchMatch) => {
    if (!onFocusSearchResult) return;
    onFocusSearchResult(match);
    setSearchQuery("");
    setIsDropdownOpen(false);
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

  return (
    <>
      {/* Unified Header Toolbar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span
          title={headerTitle}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: "0.88rem",
            fontWeight: 600,
            minWidth: 0,
            flex: "1 1 220px",
          }}
        >
          <Compass size={17} color="var(--accent-cyan)" style={{ flexShrink: 0 }} />
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {headerTitle}
          </span>
        </span>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          {onFocusSearchResult && (
            <div className="map-search-wrap" ref={searchWrapRef}>
              <Search
                size={13}
                className="map-search-icon"
                aria-hidden="true"
              />
              <input
                ref={searchInputRef}
                type="text"
                className="map-search-input"
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
                  if (
                    nextTarget &&
                    searchWrapRef.current?.contains(nextTarget)
                  ) {
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
                  className="map-search-clear"
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
                  className="map-search-dropdown"
                >
                  {searchMatches.length === 0 ? (
                    <div className="map-search-empty">
                      No matching locations or containers
                    </div>
                  ) : (
                    searchMatches.map((match, idx) => {
                      const isHighlighted = idx === clampedHighlight;
                      const isActiveLoc =
                        match.kind === "location" &&
                        match.id === activeLocationId;
                      const isCurrentCont =
                        match.kind === "container" &&
                        match.id === currentContainerId;
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
                            <span className="map-search-item-name">
                              {match.name}
                            </span>
                            <span className="map-search-item-badges">
                              {isActiveLoc && (
                                <span className="map-search-status">
                                  Active
                                </span>
                              )}
                              {!isActiveLoc && match.isStarting && (
                                <span className="map-search-status">
                                  Start
                                </span>
                              )}
                              {isCurrentCont && (
                                <span className="map-search-status">
                                  Inside
                                </span>
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
          )}

          <div
            role="group"
            aria-label="Map zoom controls"
            style={{
              display: "inline-flex",
              alignItems: "center",
              border: "1px solid var(--border-subtle)",
              borderRadius: 6,
              background: "var(--bg-card)",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              className="btn"
              disabled={zoom <= MIN_MAP_ZOOM}
              style={{
                padding: "4px 7px",
                fontSize: "0.74rem",
                border: "none",
                borderRadius: 0,
              }}
              onClick={() => setZoom((z) => clampZoom(z - 0.25))}
              title={
                zoom <= MIN_MAP_ZOOM
                  ? `Minimum zoom (${Math.round(MIN_MAP_ZOOM * 100)}%)`
                  : "Zoom Out"
              }
              aria-label="Zoom Out"
            >
              <ZoomOut size={14} />
            </button>
            <button
              type="button"
              className="btn"
              style={{
                padding: "4px 8px",
                fontSize: "0.73rem",
                fontWeight: 600,
                minWidth: 48,
                justifyContent: "center",
                border: "none",
                borderLeft: "1px solid var(--border-subtle)",
                borderRight: "1px solid var(--border-subtle)",
                borderRadius: 0,
                color:
                  Math.round(zoom * 100) === 100
                    ? "var(--text-secondary)"
                    : "var(--accent-cyan)",
              }}
              onClick={() => setZoom(1)}
              title="Reset zoom to 100%"
              aria-label={`Current zoom ${Math.round(zoom * 100)}%, click to reset`}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className="btn"
              disabled={zoom >= MAX_MAP_ZOOM}
              style={{
                padding: "4px 7px",
                fontSize: "0.74rem",
                border: "none",
                borderRadius: 0,
              }}
              onClick={() => setZoom((z) => clampZoom(z + 0.25))}
              title={
                zoom >= MAX_MAP_ZOOM
                  ? `Maximum zoom (${Math.round(MAX_MAP_ZOOM * 100)}%)`
                  : "Zoom In"
              }
              aria-label="Zoom In"
            >
              <ZoomIn size={14} />
            </button>
          </div>
          <button
            type="button"
            className="btn"
            style={{ padding: "4px 9px", fontSize: "0.74rem" }}
            onClick={handleCenter}
            title="Center on Selected / Active Location"
          >
            <Crosshair size={14} />
            Center
          </button>

          {onReimagineMap && (
            <button
              type="button"
              className="btn btn-purple"
              style={{
                padding: "4px 10px",
                fontSize: "0.74rem",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
              onClick={onReimagineMap}
            >
              <Sparkles size={13} />
              Re-imagine Map
            </button>
          )}

          {hasSaveMap && (
            <button
              type="button"
              className={`btn ${effectiveDirty && !hasBlockingErrors ? "btn-amber" : "btn-cyan"}`}
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
              onClick={handleSaveClick}
              style={{
                padding: "4px 12px",
                fontSize: "0.75rem",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              {effectiveSaving ? (
                <>Saving...</>
              ) : effectiveDirty ? (
                <>
                  <Save size={13} /> Save Map
                </>
              ) : (
                <>
                  <Check size={13} /> Map Saved
                </>
              )}
            </button>
          )}

          {onClose && (
            <button
              type="button"
              className="btn"
              style={{ padding: "4px 8px" }}
              onClick={handleCloseClick}
              title="Close Map"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Container Breadcrumbs (also acts as drag-drop target to move items outward) */}
      {(containersCount > 0 || currentContainerId) && (
        <div
          aria-label="Container hierarchy breadcrumbs"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            flexWrap: "wrap",
            background: "var(--bg-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 6,
            padding: "5px 10px",
            fontSize: "0.75rem",
            flexShrink: 0,
          }}
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
