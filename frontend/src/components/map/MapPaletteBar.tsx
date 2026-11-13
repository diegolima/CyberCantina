import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  Layers,
  LucideIcon,
  MapPin,
  RotateCcw,
} from "lucide-react";

export type PaletteItemKind = "location" | "hub" | "container";

export const PALETTE_DRAG_MIME = "application/x-cybercantina-palette";

export interface MapPaletteBarProps {
  canAddContainerHere: boolean;
  isMutatingLocked?: boolean;
  undoCount: number;
  onUndo: () => void;
  onQuickAdd: (kind: PaletteItemKind) => void;
  unreachableCount: number;
  validationMessage: string | null;
  onFocusInvalid?: () => void;
}

const PALETTE_ITEMS: Array<{
  kind: PaletteItemKind;
  label: string;
  title: string;
  accent: string;
  bg: string;
  border: string;
  Icon: LucideIcon;
}> = [
  {
    kind: "location",
    label: "+ Location",
    title: "Drag onto canvas (or click) to add an unlinked Level 0 room",
    accent: "#22d3ee",
    bg: "rgba(6, 182, 212, 0.1)",
    border: "rgba(6, 182, 212, 0.38)",
    Icon: MapPin,
  },
  {
    kind: "hub",
    label: "+ Passage Hub",
    title: "Drag onto canvas (or click) to add a corridor junction hub",
    accent: "#c084fc",
    bg: "rgba(168, 85, 247, 0.12)",
    border: "rgba(168, 85, 247, 0.42)",
    Icon: GitBranch,
  },
  {
    kind: "container",
    label: "+ Container",
    title: "Drag onto canvas (or click) to add a new Container (with entry room)",
    accent: "#fbbf24",
    bg: "rgba(245, 158, 11, 0.1)",
    border: "rgba(245, 158, 11, 0.38)",
    Icon: Layers,
  },
];

export const MapPaletteBar: React.FC<MapPaletteBarProps> = ({
  canAddContainerHere,
  isMutatingLocked = false,
  undoCount,
  onUndo,
  onQuickAdd,
  unreachableCount,
  validationMessage,
  onFocusInvalid,
}) => {
  return (
    <div
      className="map-palette-bar"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 8,
        background: "var(--bg-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 6,
        padding: "5px 10px",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: "0.68rem",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            fontWeight: 600,
            marginRight: 2,
          }}
        >
          Palette (Drag or Click):
        </span>

        {PALETTE_ITEMS.map(({ kind, label, title, accent, bg, border, Icon }) => {
          const disabled =
            isMutatingLocked || (kind === "container" && !canAddContainerHere);
          const effectiveTitle =
            kind === "container" && !canAddContainerHere
              ? "Level 1 containers cannot hold nested containers"
              : title;
          return (
            <button
              key={kind}
              type="button"
              draggable={!disabled}
              disabled={disabled}
              title={effectiveTitle}
              data-palette-kind={kind}
              onDragStart={(e) => {
                if (disabled) {
                  e.preventDefault();
                  return;
                }
                e.dataTransfer.setData(PALETTE_DRAG_MIME, kind);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => {
                if (!disabled) onQuickAdd(kind);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 9px",
                borderRadius: 5,
                fontSize: "0.72rem",
                fontWeight: 600,
                cursor: disabled ? "not-allowed" : "grab",
                opacity: disabled ? 0.45 : 1,
                background: bg,
                border: `1px solid ${border}`,
                color: accent,
              }}
            >
              <Icon size={12} color={accent} />
              <span>{label}</span>
            </button>
          );
        })}

        {undoCount > 0 && (
          <button
            type="button"
            className="btn"
            disabled={isMutatingLocked}
            onClick={onUndo}
            title="Undo last map change"
            style={{
              padding: "3px 8px",
              fontSize: "0.71rem",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              color: "#fbbf24",
              borderColor: "rgba(245, 158, 11, 0.4)",
            }}
          >
            <RotateCcw size={12} />
            <span>Undo ({undoCount})</span>
          </button>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {validationMessage || unreachableCount > 0 ? (
          <button
            type="button"
            onClick={onFocusInvalid}
            title={
              validationMessage ||
              "Some nodes cannot reach/return from the Starting Location. Link them before saving."
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 9px",
              borderRadius: 5,
              fontSize: "0.71rem",
              fontWeight: 600,
              cursor: onFocusInvalid ? "pointer" : "default",
              background: "rgba(245, 158, 11, 0.14)",
              border: "1px solid rgba(245, 158, 11, 0.45)",
              color: "#fcd34d",
            }}
          >
            <AlertTriangle size={12} color="#f59e0b" />
            <span>
              {validationMessage
                ? validationMessage
                : `${unreachableCount} Unlinked Node${unreachableCount > 1 ? "s" : ""}`}
            </span>
          </button>
        ) : (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 8px",
              borderRadius: 5,
              fontSize: "0.7rem",
              fontWeight: 600,
              background: "rgba(16, 185, 129, 0.1)",
              border: "1px solid rgba(16, 185, 129, 0.3)",
              color: "#6ee7b7",
            }}
          >
            <CheckCircle2 size={11} color="#10b981" />
            <span>All Paths Valid</span>
          </span>
        )}
      </div>
    </div>
  );
};
