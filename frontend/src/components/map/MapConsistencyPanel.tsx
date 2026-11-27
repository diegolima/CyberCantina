import React from "react";
import {
  AlertTriangle,
  Anchor,
  Check,
  CheckCircle2,
  Compass,
  Info,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import {
  formatSuggestedDistanceLabel,
  type ConsistencyReport,
  type EdgeConsistencyDiagnostic,
  type ReconciliationAdjustment,
  type WorldConsistencySummary,
} from "./spatialConsistency";

export interface MapConsistencyPanelProps {
  isOpen: boolean;
  currentContainerId: string | null;
  currentReport: ConsistencyReport;
  worldSummary: WorldConsistencySummary;
  isMutatingLocked: boolean;
  isPreviewingReconcile: boolean;
  autoSyncEnabled: boolean;
  onToggleAutoSync: (enabled: boolean) => void;
  onStartReconcilePreview: () => void;
  onApplySingleAdjustment: (adjustment: ReconciliationAdjustment) => void;
  onMarkNonEuclidean: (edgeId: string) => void;
  onJumpToDiagnostic: (diag: EdgeConsistencyDiagnostic) => void;
  onClose: () => void;
}

export const MapConsistencyPanel: React.FC<MapConsistencyPanelProps> = ({
  isOpen,
  currentContainerId,
  currentReport,
  worldSummary,
  isMutatingLocked,
  isPreviewingReconcile,
  autoSyncEnabled,
  onToggleAutoSync,
  onStartReconcilePreview,
  onApplySingleAdjustment,
  onMarkNonEuclidean,
  onJumpToDiagnostic,
  onClose,
}) => {
  if (!isOpen) return null;

  const currentScopeIssues = currentReport.diagnostics;
  const otherScopes = worldSummary.byScope.filter(
    (s) =>
      s.containerId !== currentContainerId && s.report.diagnostics.length > 0
  );
  const totalIssues =
    worldSummary.totalErrors + worldSummary.totalWarnings + worldSummary.totalInfos;
  const anchoredCount = Object.values(currentReport.anchorResolutions).filter(
    (a) => a.valid
  ).length;

  const renderIssueIcon = (severity: EdgeConsistencyDiagnostic["severity"]) => {
    if (severity === "error") {
      return <AlertTriangle size={12} color="#fb7185" style={{ flexShrink: 0 }} />;
    }
    if (severity === "warning") {
      return <AlertTriangle size={12} color="#fbbf24" style={{ flexShrink: 0 }} />;
    }
    return <Info size={12} color="#38bdf8" style={{ flexShrink: 0 }} />;
  };

  return (
    <div
      className="ui-popover map-consistency-popover"
      role="dialog"
      aria-label="Spatial Distance Consistency"
      data-testid="map-consistency-panel"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="map-consistency-header">
        <div className="map-consistency-title">
          <Compass size={14} color="var(--accent-cyan)" />
          <span>Spatial Distance Consistency</span>
          {anchoredCount > 0 && (
            <span className="badge map-consistency-anchor-count">
              <Anchor size={10} /> {anchoredCount} anchor{anchoredCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <button
          type="button"
          className="btn"
          style={{ padding: "2px 6px", fontSize: "0.68rem" }}
          aria-label="Close consistency panel"
          onClick={onClose}
        >
          <X size={12} />
        </button>
      </div>

      {/* Controls row: Auto-Sync + Preview Reconcile */}
      <div className="map-consistency-controls">
        <label
          className="map-consistency-autosync-label"
          title="When enabled, editing an anchor or link distance automatically adjusts dependent Flexible links in the current view (single Undo step)."
        >
          <input
            type="checkbox"
            checked={autoSyncEnabled}
            disabled={isMutatingLocked}
            onChange={(e) => onToggleAutoSync(e.target.checked)}
          />
          <span>Auto-Sync Unlocked Links</span>
        </label>

        {currentReport.proposedAdjustments.length > 0 && !isMutatingLocked && (
          <button
            type="button"
            className="btn btn-amber map-consistency-preview-btn"
            disabled={isPreviewingReconcile}
            data-testid="map-consistency-preview-btn"
            onClick={onStartReconcilePreview}
          >
            <Wrench size={12} />
            <span>
              Preview Reconciliation ({currentReport.proposedAdjustments.length})
            </span>
          </button>
        )}
      </div>

      {/* Diagnostic List */}
      <div className="map-consistency-body">
        {totalIssues === 0 ? (
          <div className="map-consistency-empty">
            <CheckCircle2 size={16} color="#34d399" />
            <div>
              <strong>All spatial distances are consistent.</strong>
              <div className="map-consistency-empty-sub">
                Loops, external anchors, and compass bearings align within tolerance.
              </div>
            </div>
          </div>
        ) : (
          <>
            {currentScopeIssues.length > 0 ? (
              <div className="map-consistency-section">
                <div className="map-consistency-section-title">
                  Current View ({currentScopeIssues.length})
                </div>
                {currentScopeIssues.map((diag) => {
                  const adj = currentReport.proposedByEdgeId[diag.primaryEdgeId];
                  const canApply =
                    Boolean(adj) &&
                    !isMutatingLocked &&
                    diag.kind !== "compass_conflict" &&
                    diag.kind !== "overconstrained_locked";
                  const isEdgeDiag =
                    diag.kind !== "anchor_invalid" &&
                    diag.kind !== "anchor_disconnected";
                  return (
                    <div
                      key={`${diag.pairKey}:${diag.kind}`}
                      className={`map-consistency-item map-consistency-item--${diag.severity}`}
                    >
                      <button
                        type="button"
                        className="map-consistency-item-main"
                        onClick={() => onJumpToDiagnostic(diag)}
                      >
                        {renderIssueIcon(diag.severity)}
                        <span className="map-consistency-item-text">{diag.message}</span>
                      </button>
                      <div className="map-consistency-item-actions">
                        {canApply && adj && (
                          <button
                            type="button"
                            className="btn btn-cyan map-consistency-mini-btn"
                            onClick={() => onApplySingleAdjustment(adj)}
                          >
                            <Check size={10} /> Use{" "}
                            {formatSuggestedDistanceLabel(adj.proposedMeters)}
                          </button>
                        )}
                        {isEdgeDiag && !isMutatingLocked && (
                          <button
                            type="button"
                            className="btn map-consistency-mini-btn"
                            title="Exempt this passage from Euclidean consistency checks (e.g. magic portal)"
                            onClick={() => onMarkNonEuclidean(diag.primaryEdgeId)}
                          >
                            <Sparkles size={10} /> Portal
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="map-consistency-ok-note">
                <CheckCircle2 size={13} color="#34d399" /> Current view is consistent.
              </div>
            )}

            {otherScopes.length > 0 && (
              <div className="map-consistency-section">
                <div className="map-consistency-section-title">
                  Other Views ({otherScopes.reduce((acc, s) => acc + s.report.diagnostics.length, 0)})
                </div>
                {otherScopes.map((sc) => (
                  <div key={sc.containerId ?? "__root__"} className="map-consistency-other-scope">
                    <div className="map-consistency-other-scope-label">{sc.label}</div>
                    {sc.report.diagnostics.map((diag) => (
                      <button
                        key={`${diag.pairKey}:${diag.kind}`}
                        type="button"
                        className="map-consistency-item-main map-consistency-item-main--compact"
                        onClick={() => onJumpToDiagnostic(diag)}
                      >
                        {renderIssueIcon(diag.severity)}
                        <span className="map-consistency-item-text">{diag.message}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
