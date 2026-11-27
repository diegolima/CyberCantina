import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  DoorOpen,
  Expand,
  Film,
  GitBranch,
  Image as ImageIcon,
  Layers,
  Lock,
  LogIn,
  MapPin,
  Maximize2,
  Pencil,
  RotateCcw,
  Search,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  LocationContainer,
  LocationEdge,
  LocationLoreNodeDraft,
  LocationNode,
  LocationOverrideOptions,
  LocationProp,
  LoreNode,
  MagicContextRef,
  MechanicsTopicId,
  WorldMediaItem,
} from "../../types";
import { LocationOverrideButton } from "../inspector/LocationOverrideButton";
import { ImageLightboxModal } from "../shared/ImageLightboxModal";
import { useMagicWand } from "../../hooks/useMagicWand";
import { MagicWandButton } from "../MagicWandButton";
import {
  formatDistanceCompact,
  formatTravelDuration,
} from "../../utils/spatialDistance";
import { TagChipsInput, normalizeTagList } from "../TagChipsInput";
import {
  MAP_ICON_CATEGORIES,
  MAP_ICON_OPTIONS,
  filterMapIcons,
  getDefaultMapIconKey,
  getMapIconCategoryLabel,
  getMapIconOption,
  getSuggestedMapIcons,
  resolveMapIconComponent,
  type MapIconCategory,
  type MapIconOption,
} from "./mapIcons";
import { containerHasVisitedDescendants } from "./mapValidation";
import { MapLinkInspectorSection } from "./MapLinkInspectorSection";
import { MapLoreSection } from "./MapLoreSection";
import { MapPropsSection, type PropTransferTarget } from "./MapPropsSection";
import type {
  LinkPairInspectorData,
  ProjectedGhostEdge,
  ProjectedGhostExternalNode,
} from "./topologyProjection";
import type { EdgePairPatch } from "./useTopologyMutations";
import type { WorldPromptContext } from "../../types";

export type { WorldPromptContext };

export interface ContainerSupernodeStats {
  descendantLocationCount: number;
  externalPortalsCount: number;
  hasActivePlayer: boolean;
}

export interface ExternalPortalEntry {
  edgeId: string;
  destinationName: string;
  destinationContainerName: string;
  directionLabel?: string;
  compassDirection?: string | null;
  distanceMeters: number;
  speedModifier: number;
  travelMode: string | null;
  obstacles: string[];
  isBlocked: boolean;
  isSecret: boolean;
  isUndiscoveredSecret: boolean;
}

export interface MapDetailsDrawerProps {
  mode: "editor" | "campaign";
  selectedLocation: LocationNode | null;
  selectedContainer: LocationContainer | null;
  selectedGhost?: ProjectedGhostExternalNode | null;
  selectedGhostEdges?: ProjectedGhostEdge[];
  selectedEdgePair?: LinkPairInspectorData | null;
  selectedEdgeBundle?: LinkPairInspectorData[] | null;
  returnBundleEdgeIds?: string[];
  revealedEdgeIds?: readonly string[];
  allEdges?: LocationEdge[];
  isEdgeSavedSecretInDb?: boolean;
  hasGhostOverride?: boolean;
  containers: LocationContainer[];
  allLocations: LocationNode[];
  dynamicPortalIds: Set<string>;
  externalPortals: ExternalPortalEntry[];
  containerStats: ContainerSupernodeStats | null;
  activeLocId?: string;
  worldContext?: WorldPromptContext;
  isMutatingLocked?: boolean;
  /** Whether the selected item already exists on the server (campaign lore endpoint requires saved ID). */
  isLocationSavedInDb?: boolean;
  isContainerSavedInDb?: boolean;
  depthLabels: Record<1 | 2 | 3 | 4, string>;
  onClose: () => void;
  onPatchLocation: (locId: string, patch: Partial<LocationNode>) => void;
  onPatchContainer: (contId: string, patch: Partial<LocationContainer>) => void;
  onPatchEdgePair?: (edgeId: string, patch: EdgePairPatch) => void;
  onResetCoordinates: (kind: "location" | "container", id: string) => void;
  onResetGhostCoords?: (externalLocId: string) => void;
  onDeleteEdge?: (edgeId: string) => void;
  canDeleteEdge?: (edgeId: string) => { allowed: boolean; reason?: string };
  onInspectEdgePair?: (edgeId: string, groupedEdgeIds?: string[]) => void;
  onSelectEdgePair?: (edgeId: string, returnBundleEdgeIds?: string[]) => void;
  onBackToBundle?: () => void;
  onToggleEdgeReveal?: (
    edgeId: string,
    revealed: boolean
  ) => Promise<void> | void;
  onJumpToContainer?: (containerId: string | null, focusLocId?: string) => void;
  onDrillIntoContainer: (contId: string) => void;
  coLocatedPartyNpcs?: Array<{ id: string; name: string }>;
  onOverrideLocation?: (
    locationId: string,
    options?: LocationOverrideOptions
  ) => Promise<void> | void;
  isOverriding?: boolean;
  onSaveCampaignLocationLore?: (
    locationId: string,
    drafts: LocationLoreNodeDraft[]
  ) => Promise<void> | void;
  onSaveCampaignContainerLore?: (
    containerId: string,
    drafts: LocationLoreNodeDraft[]
  ) => Promise<void> | void;
  unlockLore?: boolean;
  revealedLoreIds?: readonly string[];
  onToggleLoreReveal?: (
    loreId: string,
    revealed: boolean
  ) => Promise<void> | void;
  revealedPropIds?: readonly string[];
  worldArtifactLore?: LoreNode[];
  propTransferTargets?: PropTransferTarget[];
  onSaveCampaignLocationProps?: (
    locationId: string,
    props: LocationProp[]
  ) => Promise<void> | void;
  onTogglePropReveal?: (
    propId: string,
    revealed: boolean
  ) => Promise<void> | void;
  onTransferProp?: (
    propId: string,
    holderId: string
  ) => Promise<void> | void;
  usedIconKeys?: string[];
  worldMedia?: WorldMediaItem[];
  visitedContainerIds?: string[];
  onOpenIconBrowser?: (req: {
    targetKind: "location" | "container";
    targetId: string;
    kind: "location" | "hub" | "container";
    depth?: 1 | 2 | 3 | 4;
    currentIconKey?: string | null;
    name?: string;
    tags?: string[];
  }) => void;
  canDeleteLocation?: (locId: string) => { allowed: boolean; reason?: string };
  canDeleteContainer?: (contId: string) => { allowed: boolean; reason?: string };
  canConvertLocation?: (locId: string) => { allowed: boolean; reason?: string };
  canMoveOutToParent?: (
    kind: "location" | "container",
    id: string
  ) => { allowed: boolean; reason?: string; parentLabel?: string };
  onDeleteLocation?: (locId: string) => void;
  onDeleteContainer?: (contId: string) => void;
  onSetStartingLocation?: (locId: string) => void;
  onConvertToContainer?: (locId: string) => void;
  onMoveOutToParent?: (kind: "location" | "container", id: string) => void;
  onOpenMechanicsHelp?: (topicId: MechanicsTopicId) => void;
}

const MapIconPicker: React.FC<{
  currentIconKey?: string | null;
  kind: "location" | "hub" | "container";
  depth?: 1 | 2 | 3 | 4;
  genre?: string;
  elementName?: string;
  elementTags?: string[];
  usedIconKeys?: string[];
  disabled?: boolean;
  onSelect: (iconKey: string | null) => void;
  onOpenBrowser?: () => void;
}> = ({
  currentIconKey,
  kind,
  depth,
  genre,
  elementName,
  elementTags,
  usedIconKeys = [],
  disabled = false,
  onSelect,
  onOpenBrowser,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<MapIconCategory | "all">("all");
  const [hoveredOption, setHoveredOption] = useState<MapIconOption | null>(null);

  const defaultKey = getDefaultMapIconKey(kind, depth);
  const effectiveKey = currentIconKey || defaultKey;
  const ActiveIcon = resolveMapIconComponent(currentIconKey, kind, depth);
  const activeOption = getMapIconOption(effectiveKey);

  const filteredIcons = useMemo(
    () => filterMapIcons(query, category),
    [query, category]
  );

  const suggestedIcons = useMemo(
    () =>
      getSuggestedMapIcons({
        kind,
        depth,
        genre,
        name: elementName,
        tags: elementTags,
        limit: 12,
      }),
    [kind, depth, genre, elementName, elementTags]
  );

  const usedIcons = useMemo(() => {
    const seen = new Set<string>();
    const list: MapIconOption[] = [];
    for (const k of usedIconKeys) {
      if (seen.has(k)) continue;
      const opt = getMapIconOption(k);
      if (opt) {
        seen.add(k);
        list.push(opt);
      }
    }
    return list;
  }, [usedIconKeys]);

  const showSections = query.trim() === "" && category === "all";
  const previewOption = hoveredOption ?? activeOption ?? null;

  const renderIconTile = (opt: MapIconOption, sectionPrefix: string) => {
    const Icon = opt.Icon;
    const isSelected = effectiveKey === opt.key;
    const catLabel = getMapIconCategoryLabel(opt.category);
    return (
      <button
        key={`${sectionPrefix}:${opt.key}`}
        type="button"
        role="option"
        aria-selected={isSelected}
        aria-label={`${opt.label} (${catLabel})`}
        title={`${opt.label} (${catLabel})`}
        onMouseEnter={() => setHoveredOption(opt)}
        onFocus={() => setHoveredOption(opt)}
        onMouseLeave={() => setHoveredOption(null)}
        onClick={() => {
          onSelect(opt.key);
          setOpen(false);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 6,
          borderRadius: 5,
          border: isSelected
            ? "1px solid var(--accent-cyan)"
            : "1px solid transparent",
          background: isSelected
            ? "rgba(6, 182, 212, 0.18)"
            : "rgba(15, 23, 42, 0.55)",
          color: isSelected ? "#67e8f9" : "var(--text-secondary)",
          cursor: "pointer",
        }}
      >
        <Icon size={15} />
      </button>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn"
          disabled={disabled}
          onClick={() => {
            setOpen((v) => !v);
            setHoveredOption(null);
          }}
          aria-expanded={open}
          aria-label="Choose map icon"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 9px",
            fontSize: "0.73rem",
          }}
        >
          <ActiveIcon size={14} color="var(--accent-cyan)" />
          <span>{activeOption?.label ?? "Default Icon"}</span>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {onOpenBrowser && !disabled && (
          <button
            type="button"
            className="btn"
            style={{ padding: "3px 7px", fontSize: "0.68rem" }}
            onClick={() => {
              setOpen(false);
              onOpenBrowser();
            }}
            title={`Browse all ${MAP_ICON_OPTIONS.length} icons with full labels`}
          >
            <Expand size={11} /> Browse All
          </button>
        )}
        {currentIconKey && currentIconKey !== defaultKey && !disabled && (
          <button
            type="button"
            className="btn"
            style={{ padding: "3px 7px", fontSize: "0.68rem" }}
            onClick={() => {
              onSelect(null);
              setOpen(false);
            }}
            title="Reset to default icon for this node type"
          >
            Reset
          </button>
        )}
      </div>

      {open && !disabled && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: 7,
            background: "var(--bg-panel)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 6,
          }}
          onKeyDown={(ev) => {
            if (ev.key === "Escape") {
              ev.preventDefault();
              ev.stopPropagation();
              setOpen(false);
            }
          }}
        >
          {/* Search input */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ position: "relative", flex: 1, display: "flex", alignItems: "center" }}>
              <Search
                size={12}
                color="var(--text-muted)"
                style={{ position: "absolute", left: 7, pointerEvents: "none" }}
              />
              <input
                type="text"
                aria-label="Filter map icons"
                placeholder="Search (tavern, dock, lab, crypt)..."
                value={query}
                onChange={(ev) => setQuery(ev.target.value)}
                className="field-input"
                style={{
                  width: "100%",
                  fontSize: "0.7rem",
                  padding: "4px 22px 4px 24px",
                }}
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear icon search"
                  onClick={() => setQuery("")}
                  style={{
                    position: "absolute",
                    right: 5,
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    padding: 1,
                    display: "inline-flex",
                  }}
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>

          {/* Category filter pills */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {[
              { id: "all" as const, shortLabel: "All" },
              ...MAP_ICON_CATEGORIES,
            ].map((cat) => {
              const active = category === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.id)}
                  style={{
                    fontSize: "0.63rem",
                    padding: "2px 6px",
                    borderRadius: 999,
                    border: active
                      ? "1px solid var(--accent-cyan)"
                      : "1px solid var(--border-subtle)",
                    background: active
                      ? "rgba(6, 182, 212, 0.16)"
                      : "rgba(15, 23, 42, 0.45)",
                    color: active ? "#67e8f9" : "var(--text-muted)",
                    fontWeight: active ? 700 : 500,
                    cursor: "pointer",
                  }}
                >
                  {cat.shortLabel}
                </button>
              );
            })}
          </div>

          {/* Scrollable Icon Sections */}
          <div
            role="listbox"
            aria-label="Available map icons"
            style={{
              maxHeight: 225,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              paddingRight: 2,
            }}
          >
            {showSections ? (
              <>
                {usedIcons.length > 0 && (
                  <div>
                    <div
                      style={{
                        fontSize: "0.62rem",
                        fontWeight: 700,
                        color: "var(--text-muted)",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        marginBottom: 4,
                      }}
                    >
                      Used in World
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
                        gap: 4,
                      }}
                    >
                      {usedIcons.map((opt) => renderIconTile(opt, "used"))}
                    </div>
                  </div>
                )}

                <div>
                  <div
                    style={{
                      fontSize: "0.62rem",
                      fontWeight: 700,
                      color: "#c084fc",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      marginBottom: 4,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Sparkles size={10} /> Suggested
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
                      gap: 4,
                    }}
                  >
                    {suggestedIcons.map((opt) => renderIconTile(opt, "suggested"))}
                  </div>
                </div>

                <div>
                  <div
                    style={{
                      fontSize: "0.62rem",
                      fontWeight: 700,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      marginBottom: 4,
                    }}
                  >
                    All Icons ({MAP_ICON_OPTIONS.length})
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
                      gap: 4,
                    }}
                  >
                    {MAP_ICON_OPTIONS.map((opt) => renderIconTile(opt, "all"))}
                  </div>
                </div>
              </>
            ) : filteredIcons.length === 0 ? (
              <div
                style={{
                  padding: "14px 8px",
                  textAlign: "center",
                  fontSize: "0.7rem",
                  color: "var(--text-muted)",
                }}
              >
                <div style={{ marginBottom: 6 }}>
                  No icons match &ldquo;{query.trim()}&rdquo;.
                </div>
                <button
                  type="button"
                  className="btn"
                  style={{ fontSize: "0.66rem", padding: "2px 8px" }}
                  onClick={() => {
                    setQuery("");
                    setCategory("all");
                  }}
                >
                  Show all icons
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
                  gap: 4,
                }}
              >
                {filteredIcons.map((opt) => renderIconTile(opt, "filtered"))}
              </div>
            )}
          </div>

          {/* Hover / active icon caption footer */}
          <div
            style={{
              borderTop: "1px solid var(--border-subtle)",
              paddingTop: 5,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
              fontSize: "0.66rem",
              color: "var(--text-secondary)",
            }}
          >
            <span
              style={{
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {previewOption
                ? `${previewOption.label} · ${getMapIconCategoryLabel(previewOption.category)}`
                : "Select an icon"}
            </span>
            {onOpenBrowser && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpenBrowser();
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--accent-cyan)",
                  fontSize: "0.65rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: 0,
                  flexShrink: 0,
                }}
              >
                Browse all…
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const MapEntityImageSection: React.FC<{
  mode: "editor" | "campaign";
  entityName: string;
  imageMediaId?: string | null;
  imageUrl?: string | null;
  imageLabel?: string | null;
  videoUrl?: string | null;
  videoMimeType?: string | null;
  isVisited: boolean;
  isDisabled: boolean;
  worldMedia: WorldMediaItem[];
  onSelectMedia: (item: WorldMediaItem | null) => void;
  onEnlarge: (
    url: string,
    label: string,
    videoUrl?: string | null,
    videoMimeType?: string | null
  ) => void;
}> = ({
  mode,
  entityName,
  imageMediaId,
  imageUrl,
  imageLabel,
  videoUrl,
  videoMimeType,
  isVisited,
  isDisabled,
  worldMedia,
  onSelectMedia,
  onEnlarge,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [brokenUrls, setBrokenUrls] = useState<Record<string, boolean>>({});
  const imageChoices = useMemo(
    () => worldMedia.filter((m) => m.media_type === "image"),
    [worldMedia]
  );

  const selectedItem =
    imageChoices.find((m) => m.id === imageMediaId) ?? null;
  const resolvedUrl = selectedItem?.url ?? imageUrl ?? null;
  const resolvedLabel =
    (selectedItem?.label || imageLabel || "").trim() || entityName;
  const resolvedVideoUrl = selectedItem?.video_url ?? videoUrl ?? null;
  const resolvedVideoMimeType =
    selectedItem?.video_mime_type ?? videoMimeType ?? null;

  if (mode === "campaign") {
    if (!isVisited || !resolvedUrl || brokenUrls[resolvedUrl]) {
      return null;
    }
    return (
      <div className="field-group" style={{ gap: 6 }}>
        <label style={{ fontSize: "0.71rem" }}>Location Visual</label>
        <div
          style={{
            position: "relative",
            borderRadius: 6,
            overflow: "hidden",
            border: "1px solid var(--border-subtle)",
            background: "var(--bg-panel)",
            cursor: "pointer",
          }}
          onClick={() =>
            onEnlarge(
              resolvedUrl,
              resolvedLabel,
              resolvedVideoUrl,
              resolvedVideoMimeType
            )
          }
          title={
            resolvedVideoUrl
              ? "Click to enlarge and play video"
              : "Click to enlarge"
          }
        >
          <img
            src={resolvedUrl}
            alt={resolvedLabel}
            onError={() =>
              setBrokenUrls((prev) => ({ ...prev, [resolvedUrl]: true }))
            }
            style={{
              width: "100%",
              maxHeight: 150,
              objectFit: "cover",
              display: "block",
            }}
          />
          {resolvedVideoUrl && (
            <span
              style={{
                position: "absolute",
                top: 6,
                left: 6,
                background: "rgba(15, 23, 42, 0.82)",
                color: "#e2e8f0",
                borderRadius: 4,
                padding: "2px 6px",
                fontSize: "0.66rem",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Film size={10} /> Video
            </span>
          )}
          <span
            style={{
              position: "absolute",
              bottom: 6,
              right: 6,
              background: "rgba(15, 23, 42, 0.8)",
              color: "#e2e8f0",
              borderRadius: 4,
              padding: "2px 6px",
              fontSize: "0.66rem",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Maximize2 size={10} /> Enlarge
          </span>
        </div>
      </div>
    );
  }

  const visiblePreviewUrl =
    resolvedUrl && !brokenUrls[resolvedUrl] ? resolvedUrl : null;

  return (
    <div className="field-group" style={{ gap: 6 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
        }}
      >
        <label style={{ fontSize: "0.71rem", margin: 0 }}>
          Scene Image (Optional)
        </label>
        {!isDisabled && imageChoices.length > 0 && (
          <button
            type="button"
            className="btn"
            style={{ padding: "2px 7px", fontSize: "0.67rem" }}
            onClick={() => setPickerOpen((prev) => !prev)}
          >
            <ImageIcon size={10} />
            {pickerOpen
              ? "Hide Picker"
              : visiblePreviewUrl
              ? "Change Image"
              : "Link Image"}
          </button>
        )}
      </div>

      {visiblePreviewUrl ? (
        <div
          style={{
            position: "relative",
            borderRadius: 6,
            overflow: "hidden",
            border: "1px solid var(--border-subtle)",
            background: "var(--bg-panel)",
          }}
        >
          <img
            src={visiblePreviewUrl}
            alt={resolvedLabel}
            onError={() =>
              setBrokenUrls((prev) => ({ ...prev, [visiblePreviewUrl]: true }))
            }
            onClick={() =>
              onEnlarge(
                visiblePreviewUrl,
                resolvedLabel,
                resolvedVideoUrl,
                resolvedVideoMimeType
              )
            }
            style={{
              width: "100%",
              maxHeight: 130,
              objectFit: "cover",
              display: "block",
              cursor: "pointer",
            }}
          />
          {resolvedVideoUrl && (
            <span
              style={{
                position: "absolute",
                top: 6,
                left: 6,
                background: "rgba(15, 23, 42, 0.82)",
                color: "#e2e8f0",
                borderRadius: 4,
                padding: "2px 6px",
                fontSize: "0.66rem",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Film size={10} /> Video
            </span>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
              padding: "4px 8px",
              fontSize: "0.69rem",
              color: "var(--text-secondary)",
              borderTop: "1px solid var(--border-subtle)",
            }}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {resolvedLabel}
            </span>
            <div style={{ display: "inline-flex", gap: 4, flexShrink: 0 }}>
              <button
                type="button"
                className="btn"
                style={{ padding: "1px 6px", fontSize: "0.65rem" }}
                onClick={() =>
                  onEnlarge(
                    visiblePreviewUrl,
                    resolvedLabel,
                    resolvedVideoUrl,
                    resolvedVideoMimeType
                  )
                }
              >
                <Maximize2 size={10} />
              </button>
              {!isDisabled && (
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "1px 6px", fontSize: "0.65rem", color: "#fb7185" }}
                  onClick={() => onSelectMedia(null)}
                >
                  Unlink
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: "0.69rem", color: "var(--text-muted)" }}>
          {imageChoices.length === 0
            ? "Upload images in the World Sheet Media tab to link visuals here."
            : "No image linked."}
        </div>
      )}

      {pickerOpen && !isDisabled && imageChoices.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(78px, 1fr))",
            gap: 6,
            padding: 6,
            borderRadius: 6,
            background: "var(--bg-panel)",
            border: "1px solid var(--border-subtle)",
            maxHeight: 190,
            overflowY: "auto",
          }}
        >
          {imageChoices.map((item) => {
            const active = item.id === imageMediaId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectMedia(item);
                  setPickerOpen(false);
                }}
                style={{
                  padding: 0,
                  borderRadius: 5,
                  overflow: "hidden",
                  border: active
                    ? "2px solid var(--accent-cyan)"
                    : "1px solid var(--border-subtle)",
                  background: "var(--bg-card)",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  textAlign: "left",
                }}
                title={item.label || "World Image"}
              >
                <img
                  src={item.url}
                  alt={item.label || "World Image"}
                  style={{
                    width: "100%",
                    height: 52,
                    objectFit: "cover",
                    display: "block",
                  }}
                />
                <span
                  style={{
                    fontSize: "0.62rem",
                    padding: "2px 4px",
                    color: "var(--text-secondary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    width: "100%",
                  }}
                >
                  {item.label || "Untitled"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const MapDetailsDrawer: React.FC<MapDetailsDrawerProps> = ({
  mode,
  selectedLocation,
  selectedContainer,
  selectedGhost = null,
  selectedGhostEdges = [],
  selectedEdgePair = null,
  selectedEdgeBundle = null,
  revealedEdgeIds = [],
  allEdges = [],
  isEdgeSavedSecretInDb = false,
  hasGhostOverride = false,
  containers,
  allLocations,
  dynamicPortalIds,
  externalPortals,
  containerStats,
  activeLocId,
  worldContext,
  isMutatingLocked = false,
  isLocationSavedInDb = true,
  isContainerSavedInDb = true,
  depthLabels,
  onClose,
  onPatchLocation,
  onPatchContainer,
  onPatchEdgePair,
  onResetCoordinates,
  onResetGhostCoords,
  onDeleteEdge,
  canDeleteEdge,
  onInspectEdgePair,
  onSelectEdgePair,
  onBackToBundle,
  onToggleEdgeReveal,
  onJumpToContainer,
  onDrillIntoContainer,
  coLocatedPartyNpcs = [],
  onOverrideLocation,
  isOverriding = false,
  onSaveCampaignLocationLore,
  onSaveCampaignContainerLore,
  unlockLore = false,
  revealedLoreIds = [],
  onToggleLoreReveal,
  revealedPropIds = [],
  worldArtifactLore = [],
  propTransferTargets,
  onSaveCampaignLocationProps,
  onTogglePropReveal,
  onTransferProp,
  usedIconKeys = [],
  worldMedia = [],
  visitedContainerIds = [],
  onOpenIconBrowser,
  canDeleteLocation,
  canDeleteContainer,
  canConvertLocation,
  canMoveOutToParent,
  onDeleteLocation,
  onDeleteContainer,
  onSetStartingLocation,
  onConvertToContainer,
  onMoveOutToParent,
  onOpenMechanicsHelp,
}) => {
  const [lightboxImage, setLightboxImage] = useState<{
    url: string;
    label: string;
    videoUrl?: string | null;
    videoMimeType?: string | null;
  } | null>(null);
  const selectedLocIdRef = useRef<string | null>(selectedLocation?.id ?? null);
  selectedLocIdRef.current = selectedLocation?.id ?? null;
  const selectedContIdRef = useRef<string | null>(selectedContainer?.id ?? null);
  selectedContIdRef.current = selectedContainer?.id ?? null;
  const selectedContDepthRef = useRef<number | null>(selectedContainer?.depth ?? null);
  selectedContDepthRef.current = selectedContainer?.depth ?? null;

  const [nameDraft, setNameDraft] = useState(selectedLocation?.name ?? "");
  useEffect(() => {
    setNameDraft(selectedLocation?.name ?? "");
  }, [selectedLocation?.id, selectedLocation?.name]);

  const isLocStructuralLocked =
    isMutatingLocked ||
    (mode === "campaign" && Boolean(selectedLocation?.is_visited));
  const isLocNarrativeLocked =
    isMutatingLocked ||
    (mode === "campaign" && Boolean(selectedLocation?.is_visited) && !unlockLore);

  const isContVisited =
    visitedContainerIds.includes(selectedContainer?.id ?? "") ||
    Boolean(
      selectedContainer &&
        containerHasVisitedDescendants(
          selectedContainer.id,
          containers,
          allLocations
        )
    );
  const isContNarrativeLocked =
    isMutatingLocked ||
    (mode === "campaign" && isContVisited);

  const isLevel1ContainerSelected = Boolean(selectedContainer && selectedContainer.depth === 1);
  const selectedContainerChildNames = useMemo(() => {
    if (!selectedContainer || selectedContainer.depth !== 1) return [];
    return allLocations
      .filter((loc) => loc.container_id === selectedContainer.id)
      .map((loc) => loc.name)
      .filter((n) => n.trim().length > 0);
  }, [selectedContainer, allLocations]);

  const parentContainerName = useMemo(() => {
    const parentId = selectedContainer
      ? selectedContainer.parent_container_id
      : selectedLocation?.container_id;
    if (!parentId) return null;
    return containers.find((c) => c.id === parentId)?.name?.trim() || null;
  }, [selectedContainer, selectedLocation, containers]);

  const activeMagicEntityKey = selectedContainer
    ? `cont:${selectedContainer.id}`
    : selectedLocation
    ? `loc:${selectedLocation.id}`
    : "none";

  const isMagicWandDisabled = selectedContainer
    ? selectedContainer.depth !== 1 || isContNarrativeLocked
    : selectedLocation
    ? isLocNarrativeLocked
    : true;

  const locationContextRef = useMemo<MagicContextRef>(() => {
    if (selectedContainer && selectedContainer.depth === 1) {
      return {
        scope: "world_location",
        entity_kind: "container",
        world_id: selectedContainer.world_id || worldContext?.worldId || null,
        location_id: null,
        world_name: worldContext?.worldName || null,
        genre: worldContext?.genre || null,
        tone: worldContext?.tone || null,
        setting_overview: worldContext?.settingOverview || null,
        parent_container_name: parentContainerName,
        location_name: selectedContainer.name || null,
        location_summary: null,
        location_description: selectedContainer.description || null,
        existing_tags: selectedContainer.environmental_tags ?? [],
        child_names: selectedContainerChildNames,
      };
    }
    const loc = selectedLocation;
    return {
      scope: "world_location",
      entity_kind: "location",
      world_id: loc?.world_id || worldContext?.worldId || null,
      location_id: loc?.id || null,
      world_name: worldContext?.worldName || null,
      genre: worldContext?.genre || null,
      tone: worldContext?.tone || null,
      setting_overview: worldContext?.settingOverview || null,
      parent_container_name: parentContainerName,
      location_name: loc?.name || null,
      location_summary: loc?.summary || null,
      location_description: loc?.description || null,
      existing_tags: loc?.environmental_tags ?? [],
    };
  }, [
    selectedContainer,
    selectedContainerChildNames,
    selectedLocation,
    worldContext,
    parentContainerName,
  ]);

  const summaryWand = useMagicWand({
    fieldRole: "location_summary",
    value: selectedLocation?.summary ?? "",
    onChange: (nextText) => {
      if (selectedLocIdRef.current) {
        onPatchLocation(selectedLocIdRef.current, { summary: nextText });
      }
    },
    contextRef: locationContextRef,
    contextKey: `summary:${activeMagicEntityKey}`,
    disabled: Boolean(selectedContainer) || !selectedLocation || isLocNarrativeLocked,
    singleLine: true,
    maxWords: 20,
  });

  const descriptionWand = useMagicWand({
    fieldRole: "location_description",
    value: selectedContainer
      ? selectedContainer.description ?? ""
      : selectedLocation?.description ?? "",
    onChange: (nextText) => {
      if (selectedContIdRef.current && selectedContDepthRef.current === 1) {
        onPatchContainer(selectedContIdRef.current, { description: nextText });
      } else if (selectedLocIdRef.current) {
        onPatchLocation(selectedLocIdRef.current, { description: nextText });
      }
    },
    contextRef: locationContextRef,
    contextKey: `desc:${activeMagicEntityKey}`,
    disabled: isMagicWandDisabled,
    singleLine: false,
    maxWords: 55,
  });

  const activeEntityTags = selectedContainer
    ? selectedContainer.environmental_tags ?? []
    : selectedLocation?.environmental_tags ?? [];

  const tagsAsString = useMemo(
    () => activeEntityTags.join(", "),
    [activeEntityTags]
  );

  const tagsWand = useMagicWand({
    fieldRole: "location_tags",
    value: tagsAsString,
    onChange: (nextRaw) => {
      const parts = nextRaw
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const nextTags = normalizeTagList([], parts, 12, 48);
      if (selectedContIdRef.current && selectedContDepthRef.current === 1) {
        onPatchContainer(selectedContIdRef.current, { environmental_tags: nextTags });
      } else if (selectedLocIdRef.current) {
        onPatchLocation(selectedLocIdRef.current, { environmental_tags: nextTags });
      }
    },
    contextRef: locationContextRef,
    contextKey: `tags:${activeMagicEntityKey}`,
    disabled: isMagicWandDisabled,
    singleLine: true,
    maxWords: 32,
  });

  if (
    (selectedEdgeBundle && selectedEdgeBundle.length > 0) ||
    selectedEdgePair
  ) {
    return (
      <MapLinkInspectorSection
        mode={mode}
        unlockLore={unlockLore}
        isMutatingLocked={isMutatingLocked}
        selectedEdgePair={selectedEdgePair}
        selectedEdgeBundle={selectedEdgeBundle}
        allLocations={allLocations}
        allEdges={allEdges}
        revealedEdgeIds={revealedEdgeIds}
        isEdgeSavedSecretInDb={isEdgeSavedSecretInDb}
        onClose={onClose}
        onPatchEdgePair={onPatchEdgePair}
        onToggleEdgeReveal={onToggleEdgeReveal}
        onSelectEdgePair={onSelectEdgePair}
        onBackToBundle={onBackToBundle}
        onDeleteEdge={onDeleteEdge}
        canDeleteEdge={canDeleteEdge}
        onOpenMechanicsHelp={onOpenMechanicsHelp}
      />
    );
  }

  if (!selectedLocation && !selectedContainer && !selectedGhost) {
    return null;
  }

  if (selectedGhost) {
    const dest = selectedGhost.destination;
    const GhostIcon = resolveMapIconComponent(
      dest.icon,
      dest.is_hub ? "hub" : "location"
    );
    const locLookup = new Map(allLocations.map((l) => [l.id, l]));
    const seenPortalLinks = new Set<string>();
    const uniqueLinks = selectedGhostEdges.filter((ge) => {
      if (seenPortalLinks.has(ge.portalLocationId)) return false;
      seenPortalLinks.add(ge.portalLocationId);
      return true;
    });

    return (
      <div
        aria-label="Map Element Details"
        className="map-details-drawer"
        style={{
          background: "var(--bg-card)",
          borderRadius: 8,
          border: "1px solid var(--border-subtle)",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 11,
          overflowY: "auto",
          minHeight: 0,
          height: "100%",
          maxHeight: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span
              className="badge"
              style={{
                fontSize: "0.66rem",
                color: "#67e8f9",
                borderColor: "rgba(6, 182, 212, 0.45)",
              }}
            >
              External Destination
            </span>
            <span className="badge" style={{ fontSize: "0.64rem" }}>
              Read-Only Ghost
            </span>
          </div>
          <button
            type="button"
            className="btn"
            style={{ padding: "2px 7px", fontSize: "0.68rem" }}
            onClick={onClose}
            aria-label="Close details"
          >
            <X size={12} />
          </button>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: "0.92rem",
            fontWeight: 700,
            color: "var(--text-primary)",
          }}
        >
          <GhostIcon size={16} color="var(--accent-cyan)" />
          <span>{dest.name}</span>
        </div>

        <div
          style={{
            fontSize: "0.72rem",
            color: "var(--text-secondary)",
            background: "var(--bg-panel)",
            padding: "6px 8px",
            borderRadius: 5,
            border: "1px solid var(--border-subtle)",
          }}
        >
          Home Scope: <strong style={{ color: "#67e8f9" }}>{selectedGhost.destinationContainerName}</strong>
        </div>

        {dest.summary && (
          <div
            style={{
              fontSize: "0.75rem",
              color: "var(--text-secondary)",
              lineHeight: 1.45,
              background: "var(--bg-panel)",
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid var(--border-subtle)",
            }}
          >
            {dest.summary}
          </div>
        )}

        <div
          style={{
            fontSize: "0.7rem",
            color: "var(--text-muted)",
            lineHeight: 1.4,
          }}
        >
          Drag this ghost stub on the canvas to save its position in this view without moving its real coordinates. Narrative fields are read-only outside its home container.
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {onJumpToContainer && (
            <button
              type="button"
              className="btn btn-cyan"
              style={{
                flex: 1,
                fontSize: "0.74rem",
                justifyContent: "center",
                gap: 6,
              }}
              onClick={() => onJumpToContainer(dest.container_id ?? null, dest.id)}
            >
              <LogIn size={13} /> Jump to {selectedGhost.destinationContainerName}
            </button>
          )}
          {hasGhostOverride && !isMutatingLocked && onResetGhostCoords && (
            <button
              type="button"
              className="btn"
              style={{ fontSize: "0.72rem", gap: 5 }}
              onClick={() => onResetGhostCoords(dest.id)}
            >
              <RotateCcw size={12} /> Reset Stub
            </button>
          )}
        </div>

        <div
          style={{
            background: "var(--bg-panel)",
            border: "1px solid rgba(6, 182, 212, 0.3)",
            borderRadius: 6,
            padding: "8px 9px",
            fontSize: "0.72rem",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <span
            style={{
              fontWeight: 700,
              color: "#67e8f9",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <MapPin size={11} /> Connected Portals Here ({uniqueLinks.length})
          </span>
          {uniqueLinks.map((ge) => {
            const portalLoc = locLookup.get(ge.portalLocationId);
            const matchingGhostEdgeIds = selectedGhostEdges
              .filter((item) => item.portalLocationId === ge.portalLocationId)
              .map((item) => item.rawEdge.id);
            return (
              <div
                key={ge.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 6,
                  color: "var(--text-secondary)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div>
                    {portalLoc?.name ?? ge.portalLocationId} (
                    {formatDistanceCompact(ge.distance_meters)} ·{" "}
                    {formatTravelDuration(ge.distance_meters, ge.speed_modifier)}
                    {ge.is_blocked ? " · Blocked" : ""}
                    {ge.isUndiscoveredSecret
                      ? " · Secret"
                      : ge.is_secret
                      ? " · Discovered Secret"
                      : ""}
                    {ge.obstacles.length > 0
                      ? ` · ${ge.obstacles.join(", ")}`
                      : ""}
                    )
                  </div>
                  {ge.direction_label && (
                    <div
                      style={{
                        fontSize: "0.66rem",
                        color: "var(--text-muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={ge.direction_label}
                    >
                      via {ge.direction_label}
                    </div>
                  )}
                </div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                  {!isMutatingLocked && onInspectEdgePair && (
                    <button
                      type="button"
                      className="btn"
                      title="Edit passage label & details"
                      aria-label={`Edit link from ${portalLoc?.name ?? ge.portalLocationId}`}
                      style={{
                        padding: "2px 6px",
                        fontSize: "0.68rem",
                      }}
                      onClick={() =>
                        onInspectEdgePair(ge.rawEdge.id, matchingGhostEdgeIds)
                      }
                    >
                      <Pencil size={10} />
                    </button>
                  )}
                  {mode === "editor" && !isMutatingLocked && onDeleteEdge && (
                    <button
                      type="button"
                      className="btn"
                      title="Remove external boundary link"
                      aria-label={`Remove link from ${portalLoc?.name ?? ge.portalLocationId}`}
                      style={{
                        padding: "2px 6px",
                        fontSize: "0.68rem",
                        color: "#fb7185",
                        borderColor: "rgba(244, 63, 94, 0.35)",
                      }}
                      onClick={() => onDeleteEdge(ge.rawEdge.id)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }


  if (selectedContainer) {
    const ContIcon = resolveMapIconComponent(
      selectedContainer.icon,
      "container",
      selectedContainer.depth
    );
    const hasCoords =
      selectedContainer.ui_x != null && selectedContainer.ui_y != null;

    return (
      <div
        aria-label="Map Element Details"
        className="map-details-drawer"
        style={{
          background: "var(--bg-card)",
          borderRadius: 8,
          border: "1px solid var(--border-subtle)",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 11,
          overflowY: "auto",
          minHeight: 0,
          height: "100%",
          maxHeight: "100%",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div
            style={{
              fontSize: "0.68rem",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "#fbbf24",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <Layers size={13} />
            Level {selectedContainer.depth} · {depthLabels[selectedContainer.depth]}
          </div>
          <button
            type="button"
            className="btn"
            style={{ padding: "2px 7px", fontSize: "0.68rem" }}
            onClick={onClose}
            aria-label="Close details"
          >
            <X size={12} />
          </button>
        </div>

        <button
          type="button"
          className="btn btn-cyan"
          style={{ width: "100%", justifyContent: "center", padding: "7px 12px", fontSize: "0.78rem" }}
          onClick={() => onDrillIntoContainer(selectedContainer.id)}
        >
          <LogIn size={13} />
          Enter Container ➔
        </button>

        {/* Cosmetic Icon & Coords (Always editable unless turn busy) */}
        <div className="field-group" style={{ gap: 4 }}>
          <label style={{ fontSize: "0.71rem" }}>Container Icon (Cosmetic)</label>
          <MapIconPicker
            currentIconKey={selectedContainer.icon}
            kind="container"
            depth={selectedContainer.depth}
            genre={worldContext?.genre}
            elementName={selectedContainer.name}
            elementTags={selectedContainer.environmental_tags}
            usedIconKeys={usedIconKeys}
            disabled={isMutatingLocked}
            onSelect={(iconKey) =>
              onPatchContainer(selectedContainer.id, { icon: iconKey })
            }
            onOpenBrowser={
              onOpenIconBrowser
                ? () =>
                    onOpenIconBrowser({
                      targetKind: "container",
                      targetId: selectedContainer.id,
                      kind: "container",
                      depth: selectedContainer.depth,
                      currentIconKey: selectedContainer.icon,
                      name: selectedContainer.name,
                      tags: selectedContainer.environmental_tags,
                    })
                : undefined
            }
          />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "0.7rem",
            color: "var(--text-muted)",
            background: "var(--bg-panel)",
            padding: "5px 8px",
            borderRadius: 5,
            border: "1px solid var(--border-subtle)",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <ContIcon size={12} color="#fbbf24" />
            {hasCoords
              ? `Pinned (${Math.round(selectedContainer.ui_x!)}, ${Math.round(selectedContainer.ui_y!)})`
              : "Auto-layout position"}
          </span>
          {hasCoords && !isMutatingLocked && (
            <button
              type="button"
              className="btn"
              style={{ padding: "1px 6px", fontSize: "0.66rem" }}
              onClick={() => onResetCoordinates("container", selectedContainer.id)}
            >
              <RotateCcw size={10} /> Reset
            </button>
          )}
        </div>

        {containerStats && (
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              fontSize: "0.72rem",
              color: "var(--text-secondary)",
              background: "var(--bg-panel)",
              padding: "6px 9px",
              borderRadius: 6,
              border: "1px solid var(--border-subtle)",
            }}
          >
            <span>
              Locations: <strong>{containerStats.descendantLocationCount}</strong>
            </span>
            <span>·</span>
            <span>
              Portals: <strong>{containerStats.externalPortalsCount}</strong>
            </span>
            {containerStats.hasActivePlayer && (
              <span style={{ color: "var(--accent-amber)", fontWeight: 600 }}>
                {mode === "editor" ? "· Contains Starting Hub" : "· Party Present"}
              </span>
            )}
          </div>
        )}

        {isContNarrativeLocked && mode === "campaign" && (
          <div
            style={{
              fontSize: "0.7rem",
              color: "#fcd34d",
              background: "rgba(245, 158, 11, 0.1)",
              border: "1px solid rgba(245, 158, 11, 0.3)",
              borderRadius: 5,
              padding: "5px 8px",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Lock size={12} />
            Contains visited locations — name, description, and tags are locked. Icon and coordinates remain editable.
          </div>
        )}

        <div className="field-group" style={{ gap: 4 }}>
          <label style={{ fontSize: "0.72rem" }}>Container Name</label>
          <input
            className="field-input"
            disabled={isContNarrativeLocked}
            value={selectedContainer.name}
            onChange={(e) =>
              onPatchContainer(selectedContainer.id, { name: e.target.value })
            }
          />
        </div>

        <MapEntityImageSection
          mode={mode}
          entityName={selectedContainer.name}
          imageMediaId={selectedContainer.image_media_id}
          imageUrl={selectedContainer.image_url}
          imageLabel={selectedContainer.image_label}
          videoUrl={selectedContainer.video_url}
          videoMimeType={selectedContainer.video_mime_type}
          isVisited={isContVisited}
          isDisabled={Boolean(isMutatingLocked)}
          worldMedia={worldMedia}
          onSelectMedia={(item) =>
            onPatchContainer(selectedContainer.id, {
              image_media_id: item ? item.id : null,
              image_url: item ? item.url : null,
              image_label: item ? item.label : null,
              video_url: item ? item.video_url ?? null : null,
              video_mime_type: item ? item.video_mime_type ?? null : null,
            })
          }
          onEnlarge={(url, label, videoUrl, videoMimeType) =>
            setLightboxImage({ url, label, videoUrl, videoMimeType })
          }
        />

        <div className="field-group" style={{ gap: 4 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
            }}
          >
            <label style={{ fontSize: "0.72rem", margin: 0 }}>
              Atmospheric Description
            </label>
            {isLevel1ContainerSelected && (
              <MagicWandButton
                wand={descriptionWand}
                isInputEmpty={!selectedContainer.description.trim()}
                isSlashCommand={false}
                variant="compact"
                compactLabel="Enrich Description"
                iconAccent="amber"
              />
            )}
          </div>
          <textarea
            className="field-textarea"
            rows={3}
            disabled={isContNarrativeLocked}
            value={selectedContainer.description}
            onChange={(e) =>
              onPatchContainer(selectedContainer.id, { description: e.target.value })
            }
          />
        </div>

        <div className="field-group" style={{ gap: 4 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
            }}
          >
            <label style={{ fontSize: "0.72rem", margin: 0 }}>
              Environmental Tags
            </label>
            {isLevel1ContainerSelected && (
              <MagicWandButton
                wand={tagsWand}
                isInputEmpty={(selectedContainer.environmental_tags ?? []).length === 0}
                isSlashCommand={false}
                variant="compact"
                compactLabel="Suggest Tags"
                iconAccent="violet"
              />
            )}
          </div>
          <TagChipsInput
            value={selectedContainer.environmental_tags || []}
            disabled={isContNarrativeLocked}
            placeholder="e.g. humid, bass, neon..."
            accentVariant="cyan"
            onChange={(tags) =>
              onPatchContainer(selectedContainer.id, { environmental_tags: tags })
            }
          />
        </div>

        {selectedContainer.depth === 1 ? (
          <MapLoreSection
            mode={mode}
            isMutatingLocked={isMutatingLocked}
            targetId={selectedContainer.id}
            targetName={selectedContainer.name}
            worldId={selectedContainer.world_id}
            scopeLabel="Container Lore & Secrets"
            emptyText="No container-wide lore attached."
            loreList={selectedContainer.lore_nodes ?? []}
            canEditDraftLore={mode === "editor"}
            savedInDb={isContainerSavedInDb}
            onDraftUpdate={
              mode === "editor"
                ? (nextLore) =>
                    onPatchContainer(selectedContainer.id, { lore_nodes: nextLore })
                : undefined
            }
            onCampaignSave={onSaveCampaignContainerLore}
            unlockLore={unlockLore}
            revealedLoreIds={revealedLoreIds}
            onToggleLoreReveal={onToggleLoreReveal}
            worldContext={worldContext}
            entityKind="container"
            parentContainerName={parentContainerName}
            targetDescription={selectedContainer.description}
            targetTags={selectedContainer.environmental_tags ?? []}
          />
        ) : (
          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontStyle: "italic" }}>
            Only Level 1 landmarks hold scoped container lore.
          </div>
        )}

        {/* Touch-Accessible Container Actions (parity with right-click / Delete key) */}
        {!isMutatingLocked && (onMoveOutToParent || onDeleteContainer) && (() => {
          const moveOutCheck = canMoveOutToParent
            ? canMoveOutToParent("container", selectedContainer.id)
            : { allowed: false, parentLabel: "Parent" };
          const delCheck = canDeleteContainer
            ? canDeleteContainer(selectedContainer.id)
            : { allowed: true };
          return (
            <div className="map-drawer-actions">
              <div className="map-drawer-actions-label">Container Actions</div>
              <div className="map-drawer-actions-grid">
                {selectedContainer.parent_container_id && onMoveOutToParent && (
                  <button
                    type="button"
                    className="btn"
                    disabled={!moveOutCheck.allowed}
                    title={moveOutCheck.reason}
                    onClick={() => {
                      if (moveOutCheck.allowed) {
                        onMoveOutToParent("container", selectedContainer.id);
                      }
                    }}
                  >
                    <ArrowUpRight size={13} />
                    <span>Move Out to {moveOutCheck.parentLabel ?? "Parent"}</span>
                  </button>
                )}
                {onDeleteContainer && (
                  <button
                    type="button"
                    className="btn map-drawer-action-danger"
                    disabled={!delCheck.allowed}
                    title={delCheck.reason}
                    onClick={() => {
                      if (delCheck.allowed) {
                        onDeleteContainer(selectedContainer.id);
                      }
                    }}
                  >
                    <Trash2 size={13} />
                    <span>
                      Delete Container
                      {!delCheck.allowed && delCheck.reason ? " (Locked)" : ""}
                    </span>
                  </button>
                )}
              </div>
              {!delCheck.allowed && delCheck.reason && (
                <div className="map-drawer-action-hint">{delCheck.reason}</div>
              )}
            </div>
          );
        })()}
        {lightboxImage && (
          <ImageLightboxModal
            url={lightboxImage.url}
            label={lightboxImage.label}
            videoUrl={lightboxImage.videoUrl}
            videoMimeType={lightboxImage.videoMimeType}
            autoPlayVideo={mode === "campaign"}
            onClose={() => setLightboxImage(null)}
          />
        )}
      </div>
    );
  }

  if (!selectedLocation) return null;

  const isAnchor = selectedLocation.id === activeLocId;
  const isPortal = dynamicPortalIds.has(selectedLocation.id);
  const parentCont = selectedLocation.container_id
    ? containers.find((c) => c.id === selectedLocation.container_id)
    : null;
  const hasCoords =
    selectedLocation.ui_x != null && selectedLocation.ui_y != null;
  const LocIcon = resolveMapIconComponent(
    selectedLocation.icon,
    selectedLocation.is_hub ? "hub" : "location"
  );

  return (
    <div
      aria-label="Map Element Details"
      className="map-details-drawer"
      style={{
        background: "var(--bg-card)",
        borderRadius: 8,
        border: "1px solid var(--border-subtle)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 11,
        overflowY: "auto",
        minHeight: 0,
        height: "100%",
        maxHeight: "100%",
      }}
    >
      {/* Top Status & Badges */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
          <span
            className="badge"
            style={{
              fontSize: "0.65rem",
              color: isAnchor ? "#fbbf24" : "var(--accent-cyan)",
              borderColor: isAnchor
                ? "rgba(245, 158, 11, 0.45)"
                : "rgba(6, 182, 212, 0.35)",
            }}
          >
            {isAnchor
              ? mode === "campaign"
                ? "Current Scene"
                : "Starting Hub"
              : selectedLocation.is_starting_location
              ? "Starting Hub"
              : "Location (L0)"}
          </span>

          {selectedLocation.is_hub && (
            <span
              className="badge"
              style={{
                fontSize: "0.62rem",
                color: "#c084fc",
                borderColor: "rgba(168, 85, 247, 0.45)",
              }}
            >
              <GitBranch size={10} style={{ marginRight: 3 }} /> Passage Hub
            </span>
          )}

          {isPortal && (
            <span
              className="badge"
              style={{
                fontSize: "0.62rem",
                color: "#22d3ee",
                borderColor: "rgba(6, 182, 212, 0.45)",
              }}
            >
              <DoorOpen size={10} style={{ marginRight: 3 }} /> [Entry/Exit Portal]
            </span>
          )}

          {mode === "campaign" && (
            <span
              className="badge"
              style={{
                fontSize: "0.62rem",
                color: selectedLocation.is_visited ? "#fcd34d" : "#94a3b8",
                borderColor: selectedLocation.is_visited
                  ? "rgba(245, 158, 11, 0.4)"
                  : "rgba(148, 163, 184, 0.3)",
              }}
            >
              {selectedLocation.is_visited ? "Visited" : "Unvisited"}
            </span>
          )}
        </div>

        <button
          type="button"
          className="btn"
          style={{ padding: "2px 7px", fontSize: "0.68rem" }}
          onClick={onClose}
          aria-label="Close details"
        >
          <X size={12} />
        </button>
      </div>

      {mode === "campaign" && !isAnchor && onOverrideLocation && isLocationSavedInDb && (
        <LocationOverrideButton
          targetLocationId={selectedLocation.id}
          targetLocationName={selectedLocation.name}
          coLocatedPartyNpcs={coLocatedPartyNpcs}
          disabled={isOverriding || isMutatingLocked}
          isPending={isOverriding}
          compact
          onOverride={onOverrideLocation}
        />
      )}

      {mode === "campaign" && selectedLocation.is_visited && (
        <div
          style={{
            fontSize: "0.7rem",
            color: "#fcd34d",
            background: "rgba(245, 158, 11, 0.1)",
            border: "1px solid rgba(245, 158, 11, 0.3)",
            borderRadius: 5,
            padding: "5px 8px",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Lock size={12} />
          Visited location — narrative fields are locked for history consistency. Icon &amp; position remain editable.
        </div>
      )}

      {/* Icon Picker & Coordinates (Cosmetic — always editable) */}
      <div className="field-group" style={{ gap: 4 }}>
        <label style={{ fontSize: "0.71rem" }}>Location Icon (Cosmetic)</label>
        <MapIconPicker
          currentIconKey={selectedLocation.icon}
          kind={selectedLocation.is_hub ? "hub" : "location"}
          genre={worldContext?.genre}
          elementName={selectedLocation.name}
          elementTags={selectedLocation.environmental_tags}
          usedIconKeys={usedIconKeys}
          disabled={isMutatingLocked}
          onSelect={(iconKey) =>
            onPatchLocation(selectedLocation.id, { icon: iconKey })
          }
          onOpenBrowser={
            onOpenIconBrowser
              ? () =>
                  onOpenIconBrowser({
                    targetKind: "location",
                    targetId: selectedLocation.id,
                    kind: selectedLocation.is_hub ? "hub" : "location",
                    currentIconKey: selectedLocation.icon,
                    name: selectedLocation.name,
                    tags: selectedLocation.environmental_tags,
                  })
              : undefined
          }
        />
      </div>

      <MapEntityImageSection
        mode={mode}
        entityName={selectedLocation.name}
        imageMediaId={selectedLocation.image_media_id}
        imageUrl={selectedLocation.image_url}
        imageLabel={selectedLocation.image_label}
        videoUrl={selectedLocation.video_url}
        videoMimeType={selectedLocation.video_mime_type}
        isVisited={Boolean(selectedLocation.is_visited)}
        isDisabled={Boolean(isMutatingLocked)}
        worldMedia={worldMedia}
        onSelectMedia={(item) =>
          onPatchLocation(selectedLocation.id, {
            image_media_id: item ? item.id : null,
            image_url: item ? item.url : null,
            image_label: item ? item.label : null,
            video_url: item ? item.video_url ?? null : null,
            video_mime_type: item ? item.video_mime_type ?? null : null,
          })
        }
        onEnlarge={(url, label, videoUrl, videoMimeType) =>
          setLightboxImage({ url, label, videoUrl, videoMimeType })
        }
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "0.7rem",
          color: "var(--text-muted)",
          background: "var(--bg-panel)",
          padding: "5px 8px",
          borderRadius: 5,
          border: "1px solid var(--border-subtle)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <LocIcon size={12} color="var(--accent-cyan)" />
          {hasCoords
            ? `Pinned (${Math.round(selectedLocation.ui_x!)}, ${Math.round(selectedLocation.ui_y!)})`
            : "Auto-layout position"}
        </span>
        {hasCoords && !isMutatingLocked && (
          <button
            type="button"
            className="btn"
            style={{ padding: "1px 6px", fontSize: "0.66rem" }}
            onClick={() => onResetCoordinates("location", selectedLocation.id)}
          >
            <RotateCcw size={10} /> Auto-Place
          </button>
        )}
      </div>

      {parentCont && (
        <div
          style={{
            fontSize: "0.71rem",
            color: "var(--text-secondary)",
            background: "var(--bg-panel)",
            padding: "5px 8px",
            borderRadius: 5,
            border: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>
            Inside: <strong style={{ color: "#fbbf24" }}>{parentCont.name}</strong> (L{parentCont.depth})
          </span>
        </div>
      )}

      {/* Name */}
      <div className="field-group" style={{ gap: 4 }}>
        <label style={{ fontSize: "0.72rem" }}>Location Name</label>
        <input
          className="field-input"
          disabled={isLocNarrativeLocked}
          value={nameDraft}
          onChange={(e) => {
            const nextVal = e.target.value;
            setNameDraft(nextVal);
            if (nextVal.trim() !== "") {
              onPatchLocation(selectedLocation.id, { name: nextVal });
            }
          }}
          onBlur={() => {
            if (nameDraft.trim() === "") {
              setNameDraft(selectedLocation.name);
            }
          }}
        />
      </div>

      {/* Role toggles */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: "0.72rem",
            cursor: isLocStructuralLocked ? "not-allowed" : "pointer",
            color: selectedLocation.is_hub ? "#c084fc" : "var(--text-secondary)",
          }}
        >
          <input
            type="checkbox"
            disabled={isLocStructuralLocked}
            checked={Boolean(selectedLocation.is_hub)}
            onChange={(e) =>
              onPatchLocation(selectedLocation.id, { is_hub: e.target.checked })
            }
          />
          Passage Hub
        </label>

        {selectedLocation.container_id && (
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: "0.72rem",
              cursor: isMutatingLocked ? "not-allowed" : "pointer",
              color: selectedLocation.is_entry_exit
                ? "var(--accent-cyan)"
                : "var(--text-secondary)",
            }}
          >
            <input
              type="checkbox"
              disabled={isMutatingLocked}
              checked={Boolean(selectedLocation.is_entry_exit)}
              onChange={(e) =>
                onPatchLocation(selectedLocation.id, {
                  is_entry_exit: e.target.checked,
                })
              }
            />
            Entry/Exit Portal
          </label>
        )}
      </div>

      {/* Summary + Compact Magic Wand */}
      <div className="field-group" style={{ gap: 4 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 6,
          }}
        >
          <label style={{ fontSize: "0.72rem", margin: 0 }}>
            1-Sentence Exit Hook / Summary
          </label>
          <MagicWandButton
            wand={summaryWand}
            isInputEmpty={!(selectedLocation.summary || "").trim()}
            isSlashCommand={false}
            variant="compact"
            compactLabel="Draft Summary"
            iconAccent="amber"
          />
        </div>
        <input
          className="field-input"
          disabled={isLocNarrativeLocked}
          value={selectedLocation.summary || ""}
          placeholder="Brief hook visible from adjacent locations..."
          onChange={(e) =>
            onPatchLocation(selectedLocation.id, { summary: e.target.value })
          }
        />
      </div>

      {/* Sensory Description + Compact Magic Wand */}
      <div className="field-group" style={{ gap: 4 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 6,
          }}
        >
          <label style={{ fontSize: "0.72rem", margin: 0 }}>Sensory Description</label>
          <MagicWandButton
            wand={descriptionWand}
            isInputEmpty={!selectedLocation.description.trim()}
            isSlashCommand={false}
            variant="compact"
            compactLabel="Enrich Description"
            iconAccent="amber"
          />
        </div>
        <textarea
          className="field-textarea"
          rows={4}
          disabled={isLocNarrativeLocked}
          value={selectedLocation.description}
          onChange={(e) =>
            onPatchLocation(selectedLocation.id, { description: e.target.value })
          }
        />
      </div>

      {/* Environmental Tags + Compact Magic Wand */}
      <div className="field-group" style={{ gap: 4 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 6,
          }}
        >
          <label style={{ fontSize: "0.72rem", margin: 0 }}>Environmental Tags</label>
          <MagicWandButton
            wand={tagsWand}
            isInputEmpty={selectedLocation.environmental_tags.length === 0}
            isSlashCommand={false}
            variant="compact"
            compactLabel="Suggest Tags"
            iconAccent="violet"
          />
        </div>
        <TagChipsInput
          value={selectedLocation.environmental_tags}
          disabled={isLocNarrativeLocked}
          placeholder="e.g. dim, noisy, neon, smoke"
          accentVariant="cyan"
          onChange={(tags) =>
            onPatchLocation(selectedLocation.id, { environmental_tags: tags })
          }
        />
      </div>

      {/* Starting Message */}
      {(selectedLocation.is_starting_location || selectedLocation.starting_message) && (
        <div className="field-group" style={{ gap: 4 }}>
          <label style={{ fontSize: "0.72rem" }}>Starting Message (Turn 0 Atmosphere)</label>
          <textarea
            className="field-textarea"
            rows={2}
            disabled={isLocStructuralLocked}
            value={selectedLocation.starting_message ?? ""}
            placeholder="Opening prose when starting a campaign here..."
            onChange={(e) =>
              onPatchLocation(selectedLocation.id, {
                starting_message: e.target.value,
              })
            }
          />
        </div>
      )}

      {/* External cross-boundary note (read-only awareness; edit distance/delete directly on edge labels!) */}
      {externalPortals.length > 0 && (
        <div
          style={{
            background: "var(--bg-panel)",
            border: "1px solid rgba(6, 182, 212, 0.3)",
            borderRadius: 6,
            padding: "7px 9px",
            fontSize: "0.71rem",
            display: "flex",
            flexDirection: "column",
            gap: 3,
          }}
        >
          <span style={{ fontWeight: 700, color: "#67e8f9", display: "flex", alignItems: "center", gap: 4 }}>
            <MapPin size={11} /> External Boundary Links ({externalPortals.length})
          </span>
          {externalPortals.map((ext) => (
            <div
              key={ext.edgeId}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 6,
                color: "var(--text-secondary)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <span>
                  [{ext.compassDirection || "?"}] → {ext.destinationName} (
                  {ext.destinationContainerName},{" "}
                  {formatDistanceCompact(ext.distanceMeters)} ·{" "}
                  {formatTravelDuration(ext.distanceMeters, ext.speedModifier)}
                  {ext.isBlocked ? " · Blocked" : ""}
                  {ext.isUndiscoveredSecret
                    ? " · Secret"
                    : ext.isSecret
                    ? " · Discovered Secret"
                    : ""}
                  {ext.obstacles.length > 0
                    ? ` · ${ext.obstacles.join(", ")}`
                    : ""}
                  )
                </span>
                {ext.directionLabel && (
                  <div
                    style={{
                      fontSize: "0.66rem",
                      color: "var(--text-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={ext.directionLabel}
                  >
                    via {ext.directionLabel}
                  </div>
                )}
              </div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                {!isMutatingLocked && onInspectEdgePair && (
                  <button
                    type="button"
                    className="btn"
                    title="Edit passage label & details"
                    aria-label={`Edit link to ${ext.destinationName}`}
                    style={{
                      padding: "1px 5px",
                      fontSize: "0.66rem",
                      flexShrink: 0,
                    }}
                    onClick={() => onInspectEdgePair(ext.edgeId)}
                  >
                    <Pencil size={10} />
                  </button>
                )}
                {mode === "editor" && !isMutatingLocked && onDeleteEdge && (
                  <button
                    type="button"
                    className="btn"
                    title="Remove external boundary link"
                    aria-label={`Remove link to ${ext.destinationName}`}
                    style={{
                      padding: "1px 5px",
                      fontSize: "0.66rem",
                      color: "#fb7185",
                      borderColor: "rgba(244, 63, 94, 0.35)",
                      flexShrink: 0,
                    }}
                    onClick={() => onDeleteEdge(ext.edgeId)}
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <MapPropsSection
        mode={mode}
        isMutatingLocked={isMutatingLocked}
        locationId={selectedLocation.id}
        locationName={selectedLocation.name}
        propsList={selectedLocation.props ?? []}
        savedInDb={isLocationSavedInDb}
        worldArtifactLore={worldArtifactLore}
        unlockLore={unlockLore}
        revealedPropIds={revealedPropIds}
        onDraftUpdate={
          mode === "editor"
            ? (nextProps) =>
                onPatchLocation(selectedLocation.id, { props: nextProps })
            : undefined
        }
        onCampaignSave={onSaveCampaignLocationProps}
        onTogglePropReveal={onTogglePropReveal}
        onTransferProp={onTransferProp}
        transferTargets={propTransferTargets}
      />
      <MapLoreSection
        mode={mode}
        isMutatingLocked={isMutatingLocked}
        targetId={selectedLocation.id}
        targetName={selectedLocation.name}
        worldId={selectedLocation.world_id}
        scopeLabel="Location Lore & Secrets"
        emptyText="No local lore attached to this location."
        loreList={selectedLocation.lore_nodes ?? []}
        canEditDraftLore={mode === "editor"}
        savedInDb={isLocationSavedInDb}
        onDraftUpdate={
          mode === "editor"
            ? (nextLore) =>
                onPatchLocation(selectedLocation.id, { lore_nodes: nextLore })
            : undefined
        }
        onCampaignSave={onSaveCampaignLocationLore}
        unlockLore={unlockLore}
        revealedLoreIds={revealedLoreIds}
        onToggleLoreReveal={onToggleLoreReveal}
        worldContext={worldContext}
        entityKind="location"
        parentContainerName={parentContainerName}
        targetSummary={selectedLocation.summary}
        targetDescription={selectedLocation.description}
        targetTags={selectedLocation.environmental_tags ?? []}
      />

      {/* Touch-Accessible Location Actions (parity with right-click / Delete key) */}
      {!isMutatingLocked &&
        (onSetStartingLocation ||
          onConvertToContainer ||
          onMoveOutToParent ||
          onDeleteLocation) &&
        (() => {
          const convCheck = canConvertLocation
            ? canConvertLocation(selectedLocation.id)
            : { allowed: false };
          const moveOutCheck = canMoveOutToParent
            ? canMoveOutToParent("location", selectedLocation.id)
            : { allowed: false, parentLabel: "Parent" };
          const delCheck = canDeleteLocation
            ? canDeleteLocation(selectedLocation.id)
            : { allowed: true };
          return (
            <div className="map-drawer-actions">
              <div className="map-drawer-actions-label">Location Actions</div>
              <div className="map-drawer-actions-grid">
                {mode === "editor" &&
                  !selectedLocation.is_starting_location &&
                  onSetStartingLocation && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => onSetStartingLocation(selectedLocation.id)}
                    >
                      <Star size={13} color="#fbbf24" />
                      <span>Set as Starting Location</span>
                    </button>
                  )}
                {onConvertToContainer && (
                  <button
                    type="button"
                    className="btn"
                    disabled={!convCheck.allowed}
                    title={convCheck.reason}
                    onClick={() => {
                      if (convCheck.allowed) {
                        onConvertToContainer(selectedLocation.id);
                      }
                    }}
                  >
                    <Layers size={13} color="#fbbf24" />
                    <span>Convert to Container (L1)</span>
                  </button>
                )}
                {selectedLocation.container_id && onMoveOutToParent && (
                  <button
                    type="button"
                    className="btn"
                    disabled={!moveOutCheck.allowed}
                    title={moveOutCheck.reason}
                    onClick={() => {
                      if (moveOutCheck.allowed) {
                        onMoveOutToParent("location", selectedLocation.id);
                      }
                    }}
                  >
                    <ArrowUpRight size={13} />
                    <span>Move Out to {moveOutCheck.parentLabel ?? "Parent"}</span>
                  </button>
                )}
                {onDeleteLocation && (
                  <button
                    type="button"
                    className="btn map-drawer-action-danger"
                    disabled={!delCheck.allowed}
                    title={delCheck.reason}
                    onClick={() => {
                      if (delCheck.allowed) {
                        onDeleteLocation(selectedLocation.id);
                      }
                    }}
                  >
                    <Trash2 size={13} />
                    <span>
                      Delete Location
                      {!delCheck.allowed && delCheck.reason ? " (Locked)" : ""}
                    </span>
                  </button>
                )}
              </div>
              {!delCheck.allowed && delCheck.reason && (
                <div className="map-drawer-action-hint">{delCheck.reason}</div>
              )}
            </div>
          );
        })()}
      {lightboxImage && (
        <ImageLightboxModal
          url={lightboxImage.url}
          label={lightboxImage.label}
          videoUrl={lightboxImage.videoUrl}
          videoMimeType={lightboxImage.videoMimeType}
          autoPlayVideo={mode === "campaign"}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </div>
  );
};
