import React from "react";
import {
  Check,
  ChevronRight,
  Compass,
  Crosshair,
  FolderOpen,
  Save,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { ProjectedDepthTopology } from "./topologyProjection";

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
}) => {
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
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: "0.88rem",
            fontWeight: 600,
          }}
        >
          <Compass size={17} color="var(--accent-cyan)" />
          {title ||
            `Spatial Topology (${locationsCount} Locations, ${edgesCount} Passages)`}
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn"
            style={{ padding: "4px 8px", fontSize: "0.74rem" }}
            onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}
            title="Zoom In"
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            className="btn"
            style={{ padding: "4px 8px", fontSize: "0.74rem" }}
            onClick={() =>
              setZoom((z) => Math.max(0.35, +(z - 0.25).toFixed(2)))
            }
            title="Zoom Out"
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            className="btn"
            style={{ padding: "4px 9px", fontSize: "0.74rem" }}
            onClick={handleCenter}
            title="Center on Selected / Active Node"
          >
            <Crosshair size={14} />
            Center ({Math.round(zoom * 100)}%)
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
