import React, { useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Compass,
  DoorOpen,
  GitBranch,
  Layers,
  Lock,
  LogIn,
  MapPin,
  RotateCcw,
  X,
} from "lucide-react";
import {
  LocationContainer,
  LocationLoreNodeDraft,
  LocationNode,
  MagicContextRef,
} from "../../types";
import { useMagicWand } from "../../hooks/useMagicWand";
import { MagicWandButton } from "../MagicWandButton";
import { TagChipsInput, normalizeTagList } from "../TagChipsInput";
import {
  MAP_ICON_OPTIONS,
  getDefaultMapIconKey,
  resolveMapIconComponent,
} from "./mapIcons";
import { containerHasVisitedDescendants } from "./mapValidation";
import { MapLoreSection } from "./MapLoreSection";

export interface WorldPromptContext {
  worldId?: string;
  worldName?: string;
  genre?: string;
  tone?: string;
  settingOverview?: string;
}

export interface ContainerSupernodeStats {
  descendantLocationCount: number;
  externalPortalsCount: number;
  hasActivePlayer: boolean;
}

export interface ExternalPortalEntry {
  edgeId: string;
  destinationName: string;
  destinationContainerName: string;
  compassDirection?: string | null;
  travelMinutes: number;
  isLockedOrHidden: boolean;
}

export interface MapDetailsDrawerProps {
  mode: "editor" | "campaign";
  selectedLocation: LocationNode | null;
  selectedContainer: LocationContainer | null;
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
  onResetCoordinates: (kind: "location" | "container", id: string) => void;
  onDrillIntoContainer: (contId: string) => void;
  onOverrideLocation?: (locationId: string) => Promise<void> | void;
  isOverriding?: boolean;
  onSaveCampaignLocationLore?: (
    locationId: string,
    drafts: LocationLoreNodeDraft[]
  ) => Promise<void> | void;
  onSaveCampaignContainerLore?: (
    containerId: string,
    drafts: LocationLoreNodeDraft[]
  ) => Promise<void> | void;
}

const MapIconPicker: React.FC<{
  currentIconKey?: string | null;
  kind: "location" | "hub" | "container";
  depth?: 1 | 2 | 3 | 4;
  disabled?: boolean;
  onSelect: (iconKey: string | null) => void;
}> = ({ currentIconKey, kind, depth, disabled = false, onSelect }) => {
  const [open, setOpen] = useState(false);
  const defaultKey = getDefaultMapIconKey(kind, depth);
  const ActiveIcon = resolveMapIconComponent(currentIconKey, kind, depth);
  const activeOption = MAP_ICON_OPTIONS.find(
    (opt) => opt.key === (currentIconKey || defaultKey)
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          type="button"
          className="btn"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
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
          role="listbox"
          aria-label="Available map icons"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
            gap: 4,
            padding: 6,
            background: "var(--bg-panel)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 6,
            maxHeight: 170,
            overflowY: "auto",
          }}
        >
          {MAP_ICON_OPTIONS.map((opt) => {
            const Icon = opt.Icon;
            const isSelected = (currentIconKey || defaultKey) === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                role="option"
                aria-selected={isSelected}
                title={`${opt.label} (${opt.category})`}
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
  onResetCoordinates,
  onDrillIntoContainer,
  onOverrideLocation,
  isOverriding = false,
  onSaveCampaignLocationLore,
  onSaveCampaignContainerLore,
}) => {
  const selectedLocIdRef = useRef<string | null>(selectedLocation?.id ?? null);
  selectedLocIdRef.current = selectedLocation?.id ?? null;

  const isLocNarrativeLocked =
    isMutatingLocked ||
    (mode === "campaign" && Boolean(selectedLocation?.is_visited));

  const isContNarrativeLocked =
    isMutatingLocked ||
    (mode === "campaign" &&
      Boolean(
        selectedContainer &&
          containerHasVisitedDescendants(
            selectedContainer.id,
            containers,
            allLocations
          )
      ));

  const locationContextRef = useMemo<MagicContextRef>(() => {
    const loc = selectedLocation;
    return {
      scope: "world_location",
      world_id: loc?.world_id || worldContext?.worldId || null,
      location_id: loc?.id || null,
      world_name: worldContext?.worldName || null,
      genre: worldContext?.genre || null,
      tone: worldContext?.tone || null,
      setting_overview: worldContext?.settingOverview || null,
      location_name: loc?.name || null,
      location_summary: loc?.summary || null,
      location_description: loc?.description || null,
      existing_tags: loc?.environmental_tags ?? [],
    };
  }, [selectedLocation, worldContext]);

  const descriptionWand = useMagicWand({
    fieldRole: "location_description",
    value: selectedLocation?.description ?? "",
    onChange: (nextText) => {
      if (selectedLocIdRef.current) {
        onPatchLocation(selectedLocIdRef.current, { description: nextText });
      }
    },
    contextRef: locationContextRef,
    contextKey: `loc-desc:${selectedLocation?.id ?? "none"}`,
    disabled: !selectedLocation || isLocNarrativeLocked,
    singleLine: false,
    maxWords: 120,
  });

  const tagsAsString = useMemo(
    () => (selectedLocation?.environmental_tags ?? []).join(", "),
    [selectedLocation?.environmental_tags]
  );

  const tagsWand = useMagicWand({
    fieldRole: "location_tags",
    value: tagsAsString,
    onChange: (nextRaw) => {
      if (!selectedLocIdRef.current) return;
      const parts = nextRaw
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const nextTags = normalizeTagList([], parts, 12, 48);
      onPatchLocation(selectedLocIdRef.current, { environmental_tags: nextTags });
    },
    contextRef: locationContextRef,
    contextKey: `loc-tags:${selectedLocation?.id ?? "none"}`,
    disabled: !selectedLocation || isLocNarrativeLocked,
    singleLine: true,
    maxWords: 32,
  });

  if (!selectedLocation && !selectedContainer) {
    return null;
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
            disabled={isMutatingLocked}
            onSelect={(iconKey) =>
              onPatchContainer(selectedContainer.id, { icon: iconKey })
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
              Rooms: <strong>{containerStats.descendantLocationCount}</strong>
            </span>
            <span>·</span>
            <span>
              Portals: <strong>{containerStats.externalPortalsCount}</strong>
            </span>
            {containerStats.hasActivePlayer && (
              <span style={{ color: "var(--accent-amber)", fontWeight: 600 }}>
                · Party Present
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

        <div className="field-group" style={{ gap: 4 }}>
          <label style={{ fontSize: "0.72rem" }}>Atmospheric Description</label>
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
          <label style={{ fontSize: "0.72rem" }}>Environmental Tags</label>
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

        {selectedContainer.depth === 1 ? (          <MapLoreSection
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
          />
        ) : (
          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontStyle: "italic" }}>
            Only Level 1 landmarks hold scoped container lore.
          </div>
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
        <button
          type="button"
          className="btn btn-amber"
          style={{ width: "100%", justifyContent: "center", fontSize: "0.74rem", padding: "5px 10px" }}
          disabled={isOverriding || isMutatingLocked}
          onClick={() => onOverrideLocation(selectedLocation.id)}
        >
          <Compass size={13} />
          {isOverriding ? "Overriding Scene..." : "Move Scene Here (Override)"}
        </button>
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
          Visited room — narrative fields are locked for history consistency. Icon &amp; position remain editable.
        </div>
      )}

      {/* Icon Picker & Coordinates (Cosmetic — always editable) */}
      <div className="field-group" style={{ gap: 4 }}>
        <label style={{ fontSize: "0.71rem" }}>Location Icon (Cosmetic)</label>
        <MapIconPicker
          currentIconKey={selectedLocation.icon}
          kind={selectedLocation.is_hub ? "hub" : "location"}
          disabled={isMutatingLocked}
          onSelect={(iconKey) =>
            onPatchLocation(selectedLocation.id, { icon: iconKey })
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
          value={selectedLocation.name}
          onChange={(e) =>
            onPatchLocation(selectedLocation.id, { name: e.target.value })
          }
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
            cursor: isLocNarrativeLocked ? "not-allowed" : "pointer",
            color: selectedLocation.is_hub ? "#c084fc" : "var(--text-secondary)",
          }}
        >
          <input
            type="checkbox"
            disabled={isLocNarrativeLocked}
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

      {/* Summary */}
      <div className="field-group" style={{ gap: 4 }}>
        <label style={{ fontSize: "0.72rem" }}>1-Sentence Exit Hook / Summary</label>
        <input
          className="field-input"
          disabled={isLocNarrativeLocked}
          value={selectedLocation.summary || ""}
          placeholder="Brief hook visible from adjacent rooms..."
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
            disabled={isLocNarrativeLocked}
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
            <div key={ext.edgeId} style={{ color: "var(--text-secondary)" }}>
              [{ext.compassDirection || "?"}] → {ext.destinationName} ({ext.destinationContainerName},{" "}
              {ext.travelMinutes}m)
            </div>
          ))}
        </div>
      )}
      <MapLoreSection
        mode={mode}
        isMutatingLocked={isMutatingLocked}
        targetId={selectedLocation.id}
        targetName={selectedLocation.name}
        worldId={selectedLocation.world_id}
        scopeLabel="Location Lore & Secrets"
        emptyText="No local lore attached to this room."
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
      />
    </div>
  );
};
