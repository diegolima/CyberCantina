import React, { useEffect, useState } from "react";
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
import { CONTAINER_DEPTH_LABELS } from "./topologyProjection";

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
  if (!edges || edges.length === 0) return null;

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
        onClose();
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
            onClick={onClose}
            aria-label="Close"
          >
            <X size={13} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {edges.map((e) => {
            const fromName = locationMap.get(e.from_location_id)?.name ?? e.from_location_id;
            const toName = locationMap.get(e.to_location_id)?.name ?? e.to_location_id;
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
                  type="number"
                  min={1}
                  max={240}
                  className="field-input"
                  style={{ padding: "3px 6px", fontSize: "0.73rem" }}
                  value={e.travel_minutes}
                  onChange={(ev) => {
                    const mins = Math.max(
                      1,
                      Math.min(240, parseInt(ev.target.value, 10) || 1)
                    );
                    onUpdateDistance(e.id, mins);
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
