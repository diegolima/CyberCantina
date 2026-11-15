import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Clock,
  FolderPlus,
  GitBranch,
  Layers,
  Lock,
  LogIn,
  MapPin,
  Pencil,
  RotateCcw,
  Search,
  Sparkles,
  Star,
  Trash2,
  Unlock,
  X,
} from "lucide-react";
import {
  CompassDirection,
  LocationContainer,
  LocationEdge,
  LocationNode,
} from "../../types";
import {
  MAP_ICON_CATEGORIES,
  MAP_ICON_OPTIONS,
  filterMapIcons,
  getDefaultMapIconKey,
  getMapIconCategoryLabel,
  getMapIconOption,
  getSuggestedMapIcons,
  type MapIconCategory,
  type MapIconOption,
} from "./mapIcons";
import {
  CONTAINER_DEPTH_LABELS,
  parseCommittedEdgeMinutes,
  sanitizeEdgeMinutesInput,
  stepEdgeMinutesDraft,
} from "./topologyProjection";

export interface PassageHubCollisionState {
  sourceNodeId: string;
  sourceName: string;
  sourceSlot: CompassDirection;
  targetNodeId: string;
  targetName: string;
  targetSlot: CompassDirection;
  collidingSide: "source" | "target" | "both";
  occupiedByName: string;
  suggestedHubName: string;
  travelMinutes: number;
  x: number;
  y: number;
}

export interface PassageHubCollisionModalProps {
  state: PassageHubCollisionState | null;
  onCancel: () => void;
  onConfirm: (hubName: string, travelMinutes: number) => void;
}

export const PassageHubCollisionModal: React.FC<PassageHubCollisionModalProps> = ({
  state,
  onCancel,
  onConfirm,
}) => {
  const [hubName, setHubName] = useState("");
  const [minutes, setMinutes] = useState("2");

  useEffect(() => {
    if (state) {
      setHubName(state.suggestedHubName);
      setMinutes(String(Math.max(1, state.travelMinutes || 2)));
    }
  }, [state]);

  if (!state) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Passage Hub Collision"
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(9, 13, 22, 0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 35,
        padding: 16,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onCancel();
      }}
    >
      <div
        style={{
          width: "min(430px, 95%)",
          background: "var(--bg-card)",
          border: "1px solid rgba(168, 85, 247, 0.55)",
          borderRadius: 8,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            fontSize: "0.9rem",
            fontWeight: 700,
            color: "#c084fc",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <GitBranch size={16} />
            Create Passage Hub to Share Exit?
          </span>
          <button
            type="button"
            className="btn"
            style={{ padding: "2px 6px" }}
            onClick={onCancel}
            aria-label="Close"
          >
            <X size={13} />
          </button>
        </div>

        <div style={{ fontSize: "0.77rem", color: "var(--text-secondary)", lineHeight: 1.45 }}>
          {state.collidingSide === "target"
            ? `The [${state.targetSlot}] link node on "${state.targetName}" already connects to "${state.occupiedByName}".`
            : state.collidingSide === "both"
            ? `Both [${state.sourceSlot}] on "${state.sourceName}" and [${state.targetSlot}] on "${state.targetName}" already have active passages.`
            : `The [${state.sourceSlot}] link node on "${state.sourceName}" already connects to "${state.occupiedByName}".`}{" "}
          Inserting a <strong>Passage Hub</strong> lets paths branch cleanly from this junction. Declining cancels the link.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 8 }}>
          <div className="field-group" style={{ gap: 4 }}>
            <label style={{ fontSize: "0.72rem" }}>Passage Hub Name</label>
            <input
              className="field-input"
              value={hubName}
              onChange={(e) => setHubName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="field-group" style={{ gap: 4 }}>
            <label style={{ fontSize: "0.72rem" }}>Minutes</label>
            <input
              type="number"
              min={1}
              max={240}
              className="field-input"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <button
            type="button"
            className="btn"
            style={{ padding: "5px 11px", fontSize: "0.75rem" }}
            onClick={onCancel}
          >
            Decline (Cancel Link)
          </button>
          <button
            type="button"
            className="btn"
            disabled={!hubName.trim()}
            onClick={() =>
              onConfirm(
                hubName.trim(),
                Math.max(1, Math.min(240, parseInt(minutes, 10) || 2))
              )
            }
            style={{
              padding: "5px 12px",
              fontSize: "0.75rem",
              background: "rgba(168, 85, 247, 0.22)",
              borderColor: "rgba(168, 85, 247, 0.55)",
              color: "#e9d5ff",
              fontWeight: 600,
            }}
          >
            Create Passage Hub &amp; Link
          </button>
        </div>
      </div>
    </div>
  );
};

export interface EmptyCanvasLinkState {
  sourceKind: "location" | "container";
  sourceId: string;
  sourceName: string;
  sourceSlot: CompassDirection;
  dropX: number;
  dropY: number;
  canCreateContainer: boolean;
  availableDepths: Array<1 | 2 | 3 | 4>;
}

export interface EmptyCanvasCreateModalProps {
  state: EmptyCanvasLinkState | null;
  onCancel: () => void;
  onCreate: (opts: {
    kind: "location" | "hub" | "container";
    name: string;
    travelMinutes: number;
    containerDepth?: 1 | 2 | 3 | 4;
  }) => void;
}

export const EmptyCanvasCreateModal: React.FC<EmptyCanvasCreateModalProps> = ({
  state,
  onCancel,
  onCreate,
}) => {
  const [kind, setKind] = useState<"location" | "hub" | "container">("location");
  const [name, setName] = useState("");
  const [minutes, setMinutes] = useState("2");
  const [depth, setDepth] = useState<1 | 2 | 3 | 4>(1);

  useEffect(() => {
    if (state) {
      setKind("location");
      setName("");
      setMinutes("2");
      setDepth(state.availableDepths[0] ?? 1);
    }
  }, [state]);

  if (!state) return null;

  const placeholder =
    kind === "hub"
      ? `${state.sourceName} — Corridor`
      : kind === "container"
      ? "New District or Building"
      : "New Location Name";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create Connected Element"
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(9, 13, 22, 0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 35,
        padding: 16,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onCancel();
      }}
    >
      <div
        style={{
          width: "min(440px, 95%)",
          background: "var(--bg-card)",
          border: "1px solid rgba(6, 182, 212, 0.5)",
          borderRadius: 8,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 11,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "0.88rem",
            fontWeight: 700,
            color: "var(--accent-cyan)",
          }}
        >
          <span>Create &amp; Connect from "{state.sourceName}" [{state.sourceSlot}]</span>
          <button
            type="button"
            className="btn"
            style={{ padding: "2px 6px" }}
            onClick={onCancel}
            aria-label="Close"
          >
            <X size={13} />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
          <button
            type="button"
            className="btn"
            onClick={() => setKind("location")}
            style={{
              justifyContent: "center",
              fontSize: "0.73rem",
              padding: "6px 6px",
              borderColor: kind === "location" ? "#22d3ee" : "var(--border-subtle)",
              background:
                kind === "location" ? "rgba(6, 182, 212, 0.16)" : "var(--bg-panel)",
              color: kind === "location" ? "#67e8f9" : "var(--text-secondary)",
            }}
          >
            <MapPin size={13} /> Location
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setKind("hub")}
            style={{
              justifyContent: "center",
              fontSize: "0.73rem",
              padding: "6px 6px",
              borderColor: kind === "hub" ? "#a855f7" : "var(--border-subtle)",
              background:
                kind === "hub" ? "rgba(168, 85, 247, 0.16)" : "var(--bg-panel)",
              color: kind === "hub" ? "#e9d5ff" : "var(--text-secondary)",
            }}
          >
            <GitBranch size={13} /> Passage Hub
          </button>
          <button
            type="button"
            className="btn"
            disabled={!state.canCreateContainer || state.availableDepths.length === 0}
            onClick={() => setKind("container")}
            title={
              !state.canCreateContainer
                ? "Cannot add a container inside a Level 1 container"
                : "Create container with an auto-linked entry location"
            }
            style={{
              justifyContent: "center",
              fontSize: "0.73rem",
              padding: "6px 6px",
              borderColor: kind === "container" ? "#f59e0b" : "var(--border-subtle)",
              background:
                kind === "container" ? "rgba(245, 158, 11, 0.16)" : "var(--bg-panel)",
              color: kind === "container" ? "#fde68a" : "var(--text-secondary)",
              opacity: state.canCreateContainer ? 1 : 0.45,
            }}
          >
            <Layers size={13} /> Container
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: kind === "container" ? "1fr 110px 90px" : "1fr 90px",
            gap: 8,
          }}
        >
          <div className="field-group" style={{ gap: 4 }}>
            <label style={{ fontSize: "0.72rem" }}>Name</label>
            <input
              className="field-input"
              placeholder={placeholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          {kind === "container" && (
            <div className="field-group" style={{ gap: 4 }}>
              <label style={{ fontSize: "0.72rem" }}>Level</label>
              <select
                className="field-select"
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value) as 1 | 2 | 3 | 4)}
              >
                {state.availableDepths.map((d) => (
                  <option key={d} value={d}>
                    L{d} — {CONTAINER_DEPTH_LABELS[d]}
                    {d === 1 ? " (Lore)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field-group" style={{ gap: 4 }}>
            <label style={{ fontSize: "0.72rem" }}>Minutes</label>
            <input
              type="number"
              min={1}
              max={240}
              className="field-input"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 2 }}>
          <button
            type="button"
            className="btn"
            style={{ padding: "5px 11px", fontSize: "0.75rem" }}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-cyan"
            style={{ padding: "5px 12px", fontSize: "0.75rem" }}
            onClick={() =>
              onCreate({
                kind,
                name: name.trim() || placeholder,
                travelMinutes: Math.max(1, Math.min(240, parseInt(minutes, 10) || 2)),
                containerDepth: kind === "container" ? depth : undefined,
              })
            }
          >
            Create &amp; Link
          </button>
        </div>
      </div>
    </div>
  );
};

export interface GroupIntoContainerState {
  draggedLoc: LocationNode;
  targetLoc: LocationNode;
  parentContainerId: string | null;
}

export interface GroupIntoContainerModalProps {
  state: GroupIntoContainerState | null;
  onCancel: () => void;
  onConfirm: (containerName: string) => void;
}

export const GroupIntoContainerModal: React.FC<GroupIntoContainerModalProps> = ({
  state,
  onCancel,
  onConfirm,
}) => {
  const [name, setName] = useState("");

  useEffect(() => {
    if (state) {
      setName(state.targetLoc.name);
    }
  }, [state]);

  if (!state) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Group Locations into Container"
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(9, 13, 22, 0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 35,
        padding: 16,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onCancel();
      }}
    >
      <div
        style={{
          width: "min(410px, 95%)",
          background: "var(--bg-card)",
          border: "1px solid rgba(245, 158, 11, 0.5)",
          borderRadius: 8,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "0.88rem",
            fontWeight: 700,
            color: "var(--accent-amber)",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <FolderPlus size={16} /> Group into New Container (L1)
          </span>
          <button
            type="button"
            className="btn"
            style={{ padding: "2px 6px" }}
            onClick={onCancel}
            aria-label="Close"
          >
            <X size={13} />
          </button>
        </div>

        <div style={{ fontSize: "0.76rem", color: "var(--text-secondary)", lineHeight: 1.45 }}>
          Place <strong>{state.draggedLoc.name}</strong> and{" "}
          <strong>{state.targetLoc.name}</strong> together inside a new Level 1 container.
        </div>

        <div className="field-group" style={{ gap: 4 }}>
          <label style={{ fontSize: "0.72rem" }}>Container Name</label>
          <input
            className="field-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 2 }}>
          <button
            type="button"
            className="btn"
            style={{ padding: "5px 11px", fontSize: "0.75rem" }}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-amber"
            disabled={!name.trim()}
            style={{ padding: "5px 12px", fontSize: "0.75rem" }}
            onClick={() => onConfirm(name.trim())}
          >
            Confirm Container
          </button>
        </div>
      </div>
    </div>
  );
};

export interface StandaloneContainerCreateState {
  x: number;
  y: number;
  parentContainerId: string | null;
  availableDepths: Array<1 | 2 | 3 | 4>;
}

export interface StandaloneContainerCreateModalProps {
  state: StandaloneContainerCreateState | null;
  onCancel: () => void;
  onCreate: (opts: {
    name: string;
    depth: 1 | 2 | 3 | 4;
    createEntryLocation: boolean;
  }) => void;
}

export const StandaloneContainerCreateModal: React.FC<StandaloneContainerCreateModalProps> = ({
  state,
  onCancel,
  onCreate,
}) => {
  const [depth, setDepth] = useState<1 | 2 | 3 | 4>(1);
  const [name, setName] = useState("");
  const [createEntryLocation, setCreateEntryLocation] = useState(true);
  const [touchedEntryToggle, setTouchedEntryToggle] = useState(false);

  useEffect(() => {
    if (state) {
      const initialDepth = state.availableDepths[0] ?? 1;
      setDepth(initialDepth);
      setName("");
      setCreateEntryLocation(initialDepth === 1);
      setTouchedEntryToggle(false);
    }
  }, [state]);

  if (!state) return null;

  const macroDepths = state.availableDepths.filter((d) => d > 1);
  const placeholder = `New ${CONTAINER_DEPTH_LABELS[depth].split(" / ")[0]}`;

  const handleSelectDepth = (nextDepth: 1 | 2 | 3 | 4) => {
    setDepth(nextDepth);
    if (!touchedEntryToggle) {
      setCreateEntryLocation(nextDepth === 1);
    }
  };

  const handleSubmit = () => {
    onCreate({
      name: name.trim() || placeholder,
      depth,
      createEntryLocation,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create Container"
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(9, 13, 22, 0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 35,
        padding: 16,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onCancel();
      }}
    >
      <div
        style={{
          width: "min(460px, 95%)",
          background: "var(--bg-card)",
          border: "1px solid rgba(245, 158, 11, 0.5)",
          borderRadius: 8,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 11,
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "0.88rem",
            fontWeight: 700,
            color: "var(--accent-amber)",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Layers size={16} /> Choose Container Type
          </span>
          <button
            type="button"
            className="btn"
            style={{ padding: "2px 6px" }}
            onClick={onCancel}
            aria-label="Close"
          >
            <X size={13} />
          </button>
        </div>

        {/* Tier 1: Lore Container (Level 1) */}
        {state.availableDepths.includes(1) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span
              style={{
                fontSize: "0.68rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--text-muted)",
              }}
            >
              Lore Container
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => handleSelectDepth(1)}
              style={{
                justifyContent: "space-between",
                textAlign: "left",
                padding: "8px 10px",
                borderColor: depth === 1 ? "#f59e0b" : "var(--border-subtle)",
                background:
                  depth === 1 ? "rgba(245, 158, 11, 0.16)" : "var(--bg-panel)",
                color: depth === 1 ? "#fde68a" : "var(--text-primary)",
              }}
            >
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <strong style={{ fontSize: "0.76rem" }}>
                  L1 · {CONTAINER_DEPTH_LABELS[1]}
                </strong>
                <span style={{ fontSize: "0.69rem", color: "var(--text-secondary)" }}>
                  Holds Level 0 locations and supports Container Lore &amp; Secrets.
                </span>
              </span>
              <span
                style={{
                  fontSize: "0.68rem",
                  fontWeight: 700,
                  color: "#fbbf24",
                  marginLeft: 8,
                  flexShrink: 0,
                }}
              >
                Lore
              </span>
            </button>
          </div>
        )}

        {/* Tier 2: Higher-Level Macro Containers (Levels 2-4) */}
        {macroDepths.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span
              style={{
                fontSize: "0.68rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--text-muted)",
              }}
            >
              Higher-Level Macro Containers (Organize Sub-Containers)
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {macroDepths.map((d) => {
                const selected = depth === d;
                return (
                  <button
                    key={d}
                    type="button"
                    className="btn"
                    onClick={() => handleSelectDepth(d)}
                    style={{
                      justifyContent: "space-between",
                      textAlign: "left",
                      padding: "7px 10px",
                      borderColor: selected ? "#22d3ee" : "var(--border-subtle)",
                      background: selected
                        ? "rgba(6, 182, 212, 0.14)"
                        : "var(--bg-panel)",
                      color: selected ? "#a5f3fc" : "var(--text-primary)",
                    }}
                  >
                    <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      <strong style={{ fontSize: "0.75rem" }}>
                        L{d} · {CONTAINER_DEPTH_LABELS[d]}
                      </strong>
                      <span style={{ fontSize: "0.68rem", color: "var(--text-secondary)" }}>
                        Groups lower-level containers (L1{d > 2 ? `–L${d - 1}` : ""}) and exterior locations. No container-level lore.
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="field-group" style={{ gap: 4 }}>
          <label style={{ fontSize: "0.72rem" }}>Container Name</label>
          <input
            className="field-input"
            placeholder={placeholder}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              }
            }}
            autoFocus
          />
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 7,
            fontSize: "0.72rem",
            color: "var(--text-secondary)",
            cursor: "pointer",
            background: "var(--bg-panel)",
            padding: "7px 9px",
            borderRadius: 6,
            border: "1px solid var(--border-subtle)",
          }}
        >
          <input
            type="checkbox"
            checked={createEntryLocation}
            onChange={(e) => {
              setTouchedEntryToggle(true);
              setCreateEntryLocation(e.target.checked);
            }}
            style={{ marginTop: 2 }}
          />
          <span>
            <strong>Create initial entry location inside container</strong>
            <span style={{ display: "block", fontSize: "0.67rem", color: "var(--text-muted)" }}>
              {createEntryLocation
                ? "Adds an Entry/Exit Portal location inside so you can immediately link passages to this container."
                : "Starts empty so you can drag existing buildings or locations into it (add a location inside before linking)."}
            </span>
          </span>
        </label>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 2 }}>
          <button
            type="button"
            className="btn"
            style={{ padding: "5px 11px", fontSize: "0.75rem" }}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-amber"
            style={{ padding: "5px 12px", fontSize: "0.75rem" }}
            onClick={handleSubmit}
          >
            Create L{depth} Container
          </button>
        </div>
      </div>
    </div>
  );
};

export type ContextMenuTarget =
  | { kind: "location"; id: string }
  | { kind: "container"; id: string }
  | { kind: "edge"; edgeId: string };

export interface MapContextMenuState {
  x: number;
  y: number;
  target: ContextMenuTarget;
}

export interface MapContextMenuProps {
  menu: MapContextMenuState | null;
  locations: LocationNode[];
  containers: LocationContainer[];
  edges: LocationEdge[];
  mode: "editor" | "campaign";
  canDeleteContainer: (contId: string) => { allowed: boolean; reason?: string };
  canDeleteLocation: (locId: string) => { allowed: boolean; reason?: string };
  canConvertLocation: (locId: string) => { allowed: boolean; reason?: string };
  canMoveOutToParent: (
    kind: "location" | "container",
    id: string
  ) => { allowed: boolean; parentLabel: string; reason?: string };
  onClose: () => void;
  onInspect: (kind: "location" | "container", id: string) => void;
  onEnterContainer: (contId: string) => void;
  onSetStartingLocation: (locId: string) => void;
  onConvertToContainer: (locId: string) => void;
  onMoveOutToParent: (kind: "location" | "container", id: string) => void;
  onDeleteLocation: (locId: string) => void;
  onDeleteContainer: (contId: string) => void;
  onEditEdgeDistance: (edgeId: string) => void;
  onToggleEdgeLocked: (edgeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
}

const menuItemStyle = (disabled = false, danger = false): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  textAlign: "left",
  background: "transparent",
  border: "none",
  borderRadius: 5,
  padding: "6px 9px",
  fontSize: "0.75rem",
  color: disabled
    ? "var(--text-muted)"
    : danger
    ? "#fda4af"
    : "var(--text-primary)",
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.52 : 1,
});

export const MapContextMenu: React.FC<MapContextMenuProps> = ({
  menu,
  locations,
  containers,
  edges,
  mode,
  canDeleteContainer,
  canDeleteLocation,
  canConvertLocation,
  canMoveOutToParent,
  onClose,
  onInspect,
  onEnterContainer,
  onSetStartingLocation,
  onConvertToContainer,
  onMoveOutToParent,
  onDeleteLocation,
  onDeleteContainer,
  onEditEdgeDistance,
  onToggleEdgeLocked,
  onDeleteEdge,
}) => {
  if (!menu) return null;

  const { target } = menu;
  const loc = target.kind === "location" ? locations.find((l) => l.id === target.id) : null;
  const cont = target.kind === "container" ? containers.find((c) => c.id === target.id) : null;
  const edge = target.kind === "edge" ? edges.find((e) => e.id === target.edgeId) : null;

  return (
    <div
      role="menu"
      aria-label="Map Element Actions"
      style={{
        position: "absolute",
        left: menu.x,
        top: menu.y,
        minWidth: 215,
        background: "var(--bg-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 8,
        padding: 5,
        boxShadow: "0 12px 32px rgba(0, 0, 0, 0.55)",
        zIndex: 45,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {loc && (() => {
        const delCheck = canDeleteLocation(loc.id);
        const convCheck = canConvertLocation(loc.id);
        const moveOutCheck = canMoveOutToParent("location", loc.id);
        return (
          <>
            <div
              style={{
                padding: "3px 9px 5px",
                fontSize: "0.68rem",
                fontWeight: 700,
                color: "var(--accent-cyan)",
                borderBottom: "1px solid var(--border-subtle)",
                marginBottom: 2,
              }}
            >
              {loc.name}
            </div>
            <button
              type="button"
              style={menuItemStyle()}
              onClick={() => {
                onInspect("location", loc.id);
                onClose();
              }}
            >
              <Pencil size={13} color="#22d3ee" />
              <span>Edit Details &amp; Icon</span>
            </button>
            {mode === "editor" && !loc.is_starting_location && (
              <button
                type="button"
                style={menuItemStyle()}
                onClick={() => {
                  onSetStartingLocation(loc.id);
                  onClose();
                }}
              >
                <Star size={13} color="#fbbf24" />
                <span>Set as Starting Location</span>
              </button>
            )}
            <button
              type="button"
              style={menuItemStyle(!convCheck.allowed)}
              disabled={!convCheck.allowed}
              title={convCheck.reason}
              onClick={() => {
                if (!convCheck.allowed) return;
                onConvertToContainer(loc.id);
                onClose();
              }}
            >
              <Layers size={13} color="#fbbf24" />
              <span>Convert to Container (L1)</span>
            </button>
            {loc.container_id && (
              <button
                type="button"
                style={menuItemStyle(!moveOutCheck.allowed)}
                disabled={!moveOutCheck.allowed}
                title={moveOutCheck.reason}
                onClick={() => {
                  if (!moveOutCheck.allowed) return;
                  onMoveOutToParent("location", loc.id);
                  onClose();
                }}
              >
                <ArrowUpRight size={13} />
                <span>Move Out to {moveOutCheck.parentLabel}</span>
              </button>
            )}
            <div style={{ borderTop: "1px solid var(--border-subtle)", margin: "2px 0" }} />
            <button
              type="button"
              style={menuItemStyle(!delCheck.allowed, true)}
              disabled={!delCheck.allowed}
              title={delCheck.reason}
              onClick={() => {
                if (!delCheck.allowed) return;
                onDeleteLocation(loc.id);
                onClose();
              }}
            >
              <Trash2 size={13} />
              <span>
                Delete Location{!delCheck.allowed && delCheck.reason ? " (Locked)" : ""}
              </span>
            </button>
          </>
        );
      })()}

      {cont && (() => {
        const delCheck = canDeleteContainer(cont.id);
        const moveOutCheck = canMoveOutToParent("container", cont.id);
        return (
          <>
            <div
              style={{
                padding: "3px 9px 5px",
                fontSize: "0.68rem",
                fontWeight: 700,
                color: "#fbbf24",
                borderBottom: "1px solid var(--border-subtle)",
                marginBottom: 2,
              }}
            >
              L{cont.depth} · {cont.name}
            </div>
            <button
              type="button"
              style={menuItemStyle()}
              onClick={() => {
                onEnterContainer(cont.id);
                onClose();
              }}
            >
              <LogIn size={13} color="#22d3ee" />
              <span>Enter Container</span>
            </button>
            <button
              type="button"
              style={menuItemStyle()}
              onClick={() => {
                onInspect("container", cont.id);
                onClose();
              }}
            >
              <Pencil size={13} />
              <span>Edit Details &amp; Icon</span>
            </button>
            {cont.parent_container_id && (
              <button
                type="button"
                style={menuItemStyle(!moveOutCheck.allowed)}
                disabled={!moveOutCheck.allowed}
                title={moveOutCheck.reason}
                onClick={() => {
                  if (!moveOutCheck.allowed) return;
                  onMoveOutToParent("container", cont.id);
                  onClose();
                }}
              >
                <ArrowUpRight size={13} />
                <span>Move Out to {moveOutCheck.parentLabel}</span>
              </button>
            )}
            <div style={{ borderTop: "1px solid var(--border-subtle)", margin: "2px 0" }} />
            <button
              type="button"
              style={menuItemStyle(!delCheck.allowed, true)}
              disabled={!delCheck.allowed}
              title={delCheck.reason}
              onClick={() => {
                if (!delCheck.allowed) return;
                onDeleteContainer(cont.id);
                onClose();
              }}
            >
              <Trash2 size={13} />
              <span>Delete Container</span>
            </button>
          </>
        );
      })()}

      {edge && (
        <>
          <div
            style={{
              padding: "3px 9px 5px",
              fontSize: "0.68rem",
              fontWeight: 700,
              color: "#67e8f9",
              borderBottom: "1px solid var(--border-subtle)",
              marginBottom: 2,
            }}
          >
            Passage ({edge.travel_minutes}m)
          </div>
          <button
            type="button"
            style={menuItemStyle()}
            onClick={() => {
              onEditEdgeDistance(edge.id);
              onClose();
            }}
          >
            <Clock size={13} color="#22d3ee" />
            <span>Edit Travel Minutes</span>
          </button>
          <button
            type="button"
            style={menuItemStyle()}
            onClick={() => {
              onToggleEdgeLocked(edge.id);
              onClose();
            }}
          >
            {edge.is_locked_or_hidden ? <Unlock size={13} /> : <Lock size={13} />}
            <span>
              {edge.is_locked_or_hidden ? "Mark Accessible" : "Mark Locked / Hidden"}
            </span>
          </button>
          <div style={{ borderTop: "1px solid var(--border-subtle)", margin: "2px 0" }} />
          <button
            type="button"
            style={menuItemStyle(false, true)}
            onClick={() => {
              onDeleteEdge(edge.id);
              onClose();
            }}
          >
            <Trash2 size={13} />
            <span>Delete Passage</span>
          </button>
        </>
      )}
    </div>
  );
};

export interface MultiEdgePopoverProps {
  edges: LocationEdge[] | null;
  locationMap: Map<string, LocationNode>;
  onClose: () => void;
  onUpdateDistance: (edgeId: string, minutes: number) => void;
  onToggleLocked: (edgeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
}

export const MultiEdgePopover: React.FC<MultiEdgePopoverProps> = ({
  edges,
  locationMap,
  onClose,
  onUpdateDistance,
  onToggleLocked,
  onDeleteEdge,
}) => {
  const [draftMinutesById, setDraftMinutesById] = useState<
    Record<string, string>
  >({});
  const lastSyncedMinutesRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!edges || edges.length === 0) {
      setDraftMinutesById({});
      lastSyncedMinutesRef.current = {};
      return;
    }
    setDraftMinutesById((prev) => {
      const next: Record<string, string> = {};
      const nextSynced: Record<string, number> = {};
      for (const edge of edges) {
        const prevSynced = lastSyncedMinutesRef.current[edge.id];
        if (prev[edge.id] === undefined || prevSynced !== edge.travel_minutes) {
          next[edge.id] = String(edge.travel_minutes);
        } else {
          next[edge.id] = prev[edge.id];
        }
        nextSynced[edge.id] = edge.travel_minutes;
      }
      lastSyncedMinutesRef.current = nextSynced;
      return next;
    });
  }, [edges]);

  if (!edges || edges.length === 0) return null;

  const commitRowMinutes = (edge: LocationEdge, explicitDraft?: string) => {
    const rawDraft =
      explicitDraft ?? draftMinutesById[edge.id] ?? String(edge.travel_minutes);
    const committed = parseCommittedEdgeMinutes(rawDraft);
    const normalized = committed ?? edge.travel_minutes;
    if (committed !== null && committed !== edge.travel_minutes) {
      onUpdateDistance(edge.id, committed);
    }
    lastSyncedMinutesRef.current[edge.id] = normalized;
    setDraftMinutesById((prev) => ({
      ...prev,
      [edge.id]: String(normalized),
    }));
  };

  const handleClosePopover = () => {
    for (const edge of edges) {
      const draft = draftMinutesById[edge.id];
      if (draft !== undefined) {
        const committed = parseCommittedEdgeMinutes(draft);
        if (committed !== null && committed !== edge.travel_minutes) {
          onUpdateDistance(edge.id, committed);
        }
      }
    }
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit Boundary Passages"
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(9, 13, 22, 0.78)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 35,
        padding: 16,
      }}
      onClick={(e) => {
        e.stopPropagation();
        handleClosePopover();
      }}
    >
      <div
        style={{
          width: "min(460px, 95%)",
          background: "var(--bg-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 8,
          padding: 15,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          maxHeight: "75vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "0.86rem",
            fontWeight: 700,
            color: "var(--accent-cyan)",
          }}
        >
          <span>Boundary Passages ({edges.length})</span>
          <button
            type="button"
            className="btn"
            style={{ padding: "2px 6px" }}
            onClick={handleClosePopover}
            aria-label="Close"
          >
            <X size={13} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {edges.map((e) => {
            const fromName = locationMap.get(e.from_location_id)?.name ?? e.from_location_id;
            const toName = locationMap.get(e.to_location_id)?.name ?? e.to_location_id;
            const draftValue =
              draftMinutesById[e.id] ?? String(e.travel_minutes);
            return (
              <div
                key={e.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 72px auto auto",
                  gap: 6,
                  alignItems: "center",
                  background: "var(--bg-panel)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 6,
                  padding: "6px 8px",
                  fontSize: "0.73rem",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                    {fromName} → {toName}
                  </div>
                  <div style={{ color: "var(--text-muted)", fontSize: "0.68rem" }}>
                    [{e.compass_direction || "?"}] {e.direction_label}
                  </div>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label={`Travel minutes for ${fromName} to ${toName}`}
                  className="field-input"
                  style={{
                    padding: "3px 6px",
                    fontSize: "0.73rem",
                    textAlign: "center",
                  }}
                  value={draftValue}
                  onChange={(ev) => {
                    const digitsOnly = sanitizeEdgeMinutesInput(ev.target.value);
                    setDraftMinutesById((prev) => ({
                      ...prev,
                      [e.id]: digitsOnly,
                    }));
                  }}
                  onBlur={() => commitRowMinutes(e)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") {
                      ev.preventDefault();
                      ev.stopPropagation();
                      commitRowMinutes(e);
                    } else if (ev.key === "Escape") {
                      ev.preventDefault();
                      ev.stopPropagation();
                      setDraftMinutesById((prev) => ({
                        ...prev,
                        [e.id]: String(e.travel_minutes),
                      }));
                    } else if (ev.key === "ArrowUp") {
                      ev.preventDefault();
                      const stepped = stepEdgeMinutesDraft(
                        draftValue,
                        1,
                        e.travel_minutes
                      );
                      setDraftMinutesById((prev) => ({
                        ...prev,
                        [e.id]: stepped,
                      }));
                    } else if (ev.key === "ArrowDown") {
                      ev.preventDefault();
                      const stepped = stepEdgeMinutesDraft(
                        draftValue,
                        -1,
                        e.travel_minutes
                      );
                      setDraftMinutesById((prev) => ({
                        ...prev,
                        [e.id]: stepped,
                      }));
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "4px 6px" }}
                  title={e.is_locked_or_hidden ? "Locked / Hidden" : "Accessible"}
                  onClick={() => onToggleLocked(e.id)}
                >
                  {e.is_locked_or_hidden ? (
                    <Lock size={12} color="#fda4af" />
                  ) : (
                    <Unlock size={12} />
                  )}
                </button>
                <button
                  type="button"
                  className="item-remove-btn"
                  title="Delete passage"
                  onClick={() => onDeleteEdge(e.id)}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export interface MapIconBrowserModalProps {
  isOpen: boolean;
  title: string;
  currentIconKey?: string | null;
  kind: "location" | "hub" | "container";
  depth?: 1 | 2 | 3 | 4;
  genre?: string;
  elementName?: string;
  elementTags?: string[];
  usedIconKeys?: string[];
  onSelect: (iconKey: string | null) => void;
  onClose: () => void;
}

type BrowserScope = "all" | "suggested" | "used" | MapIconCategory;

export const MapIconBrowserModal: React.FC<MapIconBrowserModalProps> = ({
  isOpen,
  title,
  currentIconKey,
  kind,
  depth,
  genre,
  elementName,
  elementTags,
  usedIconKeys = [],
  onSelect,
  onClose,
}) => {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<BrowserScope>("all");
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setScope("all");
    searchInputRef.current?.focus();
  }, [isOpen]);

  const defaultKey = getDefaultMapIconKey(kind, depth);
  const effectiveKey = currentIconKey || defaultKey;

  const suggestedIcons = useMemo(
    () =>
      getSuggestedMapIcons({
        kind,
        depth,
        genre,
        name: elementName,
        tags: elementTags,
        limit: 18,
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

  const queryMatchedAll = useMemo(() => filterMapIcons(query, "all"), [query]);

  const categoryCounts = useMemo(() => {
    const counts: Record<MapIconCategory, number> = {
      settlement: 0,
      transit: 0,
      wilderness: 0,
      scifi: 0,
      arcana: 0,
      hazard: 0,
    };
    for (const opt of queryMatchedAll) {
      counts[opt.category] += 1;
    }
    return counts;
  }, [queryMatchedAll]);

  const visibleIcons = useMemo(() => {
    const filterList = (list: MapIconOption[]) => {
      const allowed = new Set(queryMatchedAll.map((o) => o.key));
      return list.filter((o) => allowed.has(o.key));
    };
    if (scope === "suggested") return filterList(suggestedIcons);
    if (scope === "used") return filterList(usedIcons);
    if (scope === "all") return queryMatchedAll;
    return queryMatchedAll.filter((o) => o.category === scope);
  }, [scope, queryMatchedAll, suggestedIcons, usedIcons]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Browse Map Icons"
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(9, 13, 22, 0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 45,
        padding: 16,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        style={{
          width: "min(680px, 96%)",
          height: "min(520px, 86%)",
          background: "var(--bg-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 18px 48px rgba(0, 0, 0, 0.65)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "11px 14px",
            borderBottom: "1px solid var(--border-subtle)",
            gap: 10,
          }}
        >
          <div>
            <div style={{ fontSize: "0.88rem", fontWeight: 700, color: "var(--accent-cyan)" }}>
              Choose Map Icon — {title}
            </div>
            <div style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
              {MAP_ICON_OPTIONS.length} worldbuilding icons across {MAP_ICON_CATEGORIES.length} categories
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {currentIconKey && currentIconKey !== defaultKey && (
              <button
                type="button"
                className="btn"
                style={{ padding: "4px 8px", fontSize: "0.7rem" }}
                onClick={() => {
                  onSelect(null);
                  onClose();
                }}
              >
                <RotateCcw size={11} /> Reset Default
              </button>
            )}
            <button
              type="button"
              className="btn"
              style={{ padding: "4px 7px" }}
              onClick={onClose}
              aria-label="Close icon browser"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div
          style={{
            padding: "8px 14px",
            borderBottom: "1px solid var(--border-subtle)",
            background: "var(--bg-panel)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Search size={14} color="var(--text-muted)" />
          <input
            ref={searchInputRef}
            type="text"
            aria-label="Search map icons"
            placeholder="Search by place, motif, or tag (e.g. tavern, dock, clinic, crypt)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="field-input"
            style={{ flex: 1, fontSize: "0.76rem", padding: "5px 8px" }}
          />
          {query && (
            <button
              type="button"
              className="btn"
              style={{ padding: "4px 8px", fontSize: "0.69rem" }}
              onClick={() => setQuery("")}
            >
              Clear
            </button>
          )}
        </div>

        {/* Body: Sidebar + Grid */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: "180px 1fr",
          }}
        >
          {/* Category Sidebar */}
          <div
            role="tablist"
            aria-label="Icon Categories"
            style={{
              borderRight: "1px solid var(--border-subtle)",
              padding: 8,
              display: "flex",
              flexDirection: "column",
              gap: 3,
              overflowY: "auto",
              background: "rgba(9, 13, 22, 0.35)",
            }}
          >
            {[
              {
                id: "all" as const,
                label: "All Icons",
                count: queryMatchedAll.length,
              },
              {
                id: "suggested" as const,
                label: "Suggested",
                count: suggestedIcons.filter((s) =>
                  queryMatchedAll.some((m) => m.key === s.key)
                ).length,
                accent: "#c084fc",
              },
              ...(usedIcons.length > 0
                ? [
                    {
                      id: "used" as const,
                      label: "Used in World",
                      count: usedIcons.filter((u) =>
                        queryMatchedAll.some((m) => m.key === u.key)
                      ).length,
                    },
                  ]
                : []),
            ].map((item) => {
              const active = scope === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setScope(item.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 8px",
                    borderRadius: 6,
                    border: active
                      ? "1px solid rgba(6, 182, 212, 0.55)"
                      : "1px solid transparent",
                    background: active ? "rgba(6, 182, 212, 0.14)" : "transparent",
                    color: active ? "#67e8f9" : "var(--text-secondary)",
                    fontSize: "0.73rem",
                    fontWeight: active ? 700 : 500,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    {item.id === "suggested" && (
                      <Sparkles size={11} color={item.accent} />
                    )}
                    {item.label}
                  </span>
                  <span style={{ fontSize: "0.66rem", opacity: 0.75 }}>{item.count}</span>
                </button>
              );
            })}

            <div style={{ borderTop: "1px solid var(--border-subtle)", margin: "4px 0" }} />

            {MAP_ICON_CATEGORIES.map((cat) => {
              const active = scope === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setScope(cat.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 8px",
                    borderRadius: 6,
                    border: active
                      ? "1px solid rgba(6, 182, 212, 0.55)"
                      : "1px solid transparent",
                    background: active ? "rgba(6, 182, 212, 0.14)" : "transparent",
                    color: active ? "#67e8f9" : "var(--text-secondary)",
                    fontSize: "0.72rem",
                    fontWeight: active ? 700 : 500,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span>{cat.label}</span>
                  <span style={{ fontSize: "0.66rem", opacity: 0.75 }}>
                    {categoryCounts[cat.id]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Labeled Icon Grid */}
          <div style={{ padding: 12, overflowY: "auto", minHeight: 0 }}>
            {visibleIcons.length === 0 ? (
              <div
                style={{
                  padding: "36px 16px",
                  textAlign: "center",
                  color: "var(--text-muted)",
                  fontSize: "0.78rem",
                }}
              >
                <div style={{ marginBottom: 8 }}>
                  No icons match &ldquo;{query.trim()}&rdquo;.
                </div>
                <button
                  type="button"
                  className="btn"
                  style={{ fontSize: "0.72rem", padding: "4px 10px" }}
                  onClick={() => {
                    setQuery("");
                    setScope("all");
                  }}
                >
                  Show all icons
                </button>
              </div>
            ) : (
              <div
                role="listbox"
                aria-label="Icon browser results"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(136px, 1fr))",
                  gap: 6,
                }}
              >
                {visibleIcons.map((opt) => {
                  const Icon = opt.Icon;
                  const isSelected = effectiveKey === opt.key;
                  const catLabel = getMapIconCategoryLabel(opt.category);
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        onSelect(opt.key);
                        onClose();
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "7px 8px",
                        borderRadius: 6,
                        border: isSelected
                          ? "1px solid var(--accent-cyan)"
                          : "1px solid var(--border-subtle)",
                        background: isSelected
                          ? "rgba(6, 182, 212, 0.16)"
                          : "var(--bg-panel)",
                        color: isSelected ? "#67e8f9" : "var(--text-primary)",
                        cursor: "pointer",
                        textAlign: "left",
                        minWidth: 0,
                      }}
                    >
                      <Icon
                        size={16}
                        style={{ flexShrink: 0 }}
                        color={isSelected ? "#22d3ee" : "#cbd5e1"}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: "0.72rem",
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {opt.label}
                        </div>
                        <div
                          style={{
                            fontSize: "0.61rem",
                            color: "var(--text-muted)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {catLabel}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
