import React, { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Settings,
  X,
} from "lucide-react";
import type { Phase4BudgetReport, TelemetryPhaseKey, TurnTelemetry } from "../../types";
import {
  PHASE_DISPLAY_META,
  TELEMETRY_PHASE_ORDER,
  buildActionableRecommendation,
  formatTokenCount,
  getHealthStatusColor,
  getHealthStatusLabel,
  getPhaseSummary,
} from "./contextHealthHelpers";

interface ContextHealthModalProps {
  isOpen: boolean;
  onClose: () => void;
  telemetry: TurnTelemetry | null;
  turnDepth?: number | null;
  onOpenSettings?: () => void;
}

const ZoneBreakdownBar: React.FC<{
  report: Phase4BudgetReport;
  completionTokens: number;
}> = ({ report, completionTokens }) => {
  const segments = [
    { key: "z1", label: "Zone 1 Static", tokens: report.zone1_tokens, color: "#38bdf8" },
    { key: "z2", label: "Zone 2 Episodic", tokens: report.zone2_tokens, color: "#a78bfa" },
    { key: "z3", label: "Zone 3 Working Mem", tokens: report.zone3_tokens, color: "#10b981" },
    { key: "z4", label: "Zone 4 Ephemeral/RAG", tokens: report.zone4_tokens, color: "#f59e0b" },
    { key: "out", label: "Output", tokens: completionTokens, color: "#94a3b8" },
  ];
  const total = segments.reduce((acc, s) => acc + s.tokens, 0);
  if (total <= 0) return null;

  return (
    <div className="context-health-zones">
      <div className="context-health-zones-bar" aria-label="Phase 4 4-zone token distribution">
        {segments.map((seg) =>
          seg.tokens > 0 ? (
            <div
              key={seg.key}
              className="context-health-zone-seg"
              style={{
                width: `${(seg.tokens / total) * 100}%`,
                background: seg.color,
              }}
              title={`${seg.label}: ~${formatTokenCount(seg.tokens)} tok (${Math.round((seg.tokens / total) * 100)}%)`}
            />
          ) : null,
        )}
      </div>
      <div className="context-health-zones-legend">
        {segments.map((seg) => (
          <span key={seg.key} className="context-health-zone-item">
            <span
              className="context-health-zone-swatch"
              style={{ background: seg.color }}
              aria-hidden="true"
            />
            <span>{seg.label}:</span>
            <strong>{formatTokenCount(seg.tokens)}</strong>
          </span>
        ))}
      </div>
    </div>
  );
};

export const ContextHealthModal: React.FC<ContextHealthModalProps> = ({
  isOpen,
  onClose,
  telemetry,
  turnDepth,
  onOpenSettings,
}) => {
  const [expandedPhases, setExpandedPhases] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const overallStatus = telemetry?.overall_status ?? "idle";
  const statusLabel = getHealthStatusLabel(overallStatus);
  const statusColor = getHealthStatusColor(overallStatus);
  const recommendation = buildActionableRecommendation(telemetry);

  const toggleExpand = (phaseKey: TelemetryPhaseKey) => {
    setExpandedPhases((prev) => ({ ...prev, [phaseKey]: !prev[phaseKey] }));
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Context Health & Turn Telemetry"
      onClick={onClose}
    >
      <div
        className="modal-card context-health-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Activity size={18} color={statusColor} />
            <h2 style={{ margin: 0, fontSize: "1.02rem" }}>Context Health</h2>
            <span
              className={`context-health-status-badge context-health-${overallStatus}`}
              style={{
                borderColor: statusColor,
                color: statusColor,
              }}
            >
              {statusLabel}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-icon"
            onClick={onClose}
            aria-label="Close Context Health modal"
          >
            <X size={16} />
          </button>
        </div>

        <div className="modal-body context-health-modal-body">
          {!telemetry || overallStatus === "idle" ? (
            <div className="ui-empty-state ui-empty-state--dashed">
              <p style={{ margin: 0, fontWeight: 600 }}>No turn telemetry recorded yet.</p>
              <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: "0.84rem" }}>
                Send a message in this campaign to capture exact per-phase token usage, working-memory
                trimming, and context-window headroom across all 4 LLM phases.
              </p>
            </div>
          ) : (
            <>
              <div className="context-health-summary-bar">
                <div className="context-health-summary-stat">
                  <span className="context-health-stat-label">Turn</span>
                  <strong>{turnDepth != null ? `#${turnDepth}` : "Latest"}</strong>
                </div>
                <div className="context-health-summary-stat">
                  <span className="context-health-stat-label">Total Prompt</span>
                  <strong>{formatTokenCount(telemetry.total_prompt_tokens)} tok</strong>
                </div>
                <div className="context-health-summary-stat">
                  <span className="context-health-stat-label">Total Output</span>
                  <strong>{formatTokenCount(telemetry.total_completion_tokens)} tok</strong>
                </div>
                <div className="context-health-summary-stat">
                  <span className="context-health-stat-label">Measurement</span>
                  <strong>
                    {telemetry.usage_source === "exact"
                      ? "Exact (Provider)"
                      : telemetry.usage_source === "mixed"
                        ? "Mixed (Exact + Est.)"
                        : "Estimated"}
                  </strong>
                </div>
              </div>

              {recommendation && (
                <div
                  className={`context-health-recommendation context-health-${overallStatus}`}
                  style={{ borderColor: statusColor }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <AlertTriangle
                      size={16}
                      color={statusColor}
                      style={{ flexShrink: 0, marginTop: 2 }}
                    />
                    <div style={{ flex: 1, fontSize: "0.83rem", lineHeight: 1.45 }}>
                      {recommendation}
                    </div>
                  </div>
                  {onOpenSettings && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        onClose();
                        onOpenSettings();
                      }}
                      style={{ flexShrink: 0 }}
                    >
                      <Settings size={13} />
                      Open Model Settings
                    </button>
                  )}
                </div>
              )}

              <div className="context-health-phase-list">
                {TELEMETRY_PHASE_ORDER.map((phaseKey) => {
                  const meta = PHASE_DISPLAY_META[phaseKey];
                  const summary = getPhaseSummary(telemetry, phaseKey);
                  const phaseStatus = summary?.status ?? "idle";
                  const phaseColor = getHealthStatusColor(phaseStatus);
                  const pct = summary?.peak_utilization_pct ?? null;
                  const visualWidth =
                    phaseStatus === "idle"
                      ? 0
                      : pct != null
                        ? Math.min(100, Math.max(2, pct))
                        : 25;
                  const isOverflow = pct != null && pct > 100;
                  const isExpanded = Boolean(expandedPhases[phaseKey]);
                  const hasCalls = Boolean(summary && summary.calls.length > 0);
                  const isPending = phaseKey === "phase5_clerk" && telemetry.phase5_pending;

                  return (
                    <div
                      key={phaseKey}
                      className={`context-health-phase-card context-health-${phaseStatus}`}
                    >
                      <button
                        type="button"
                        className="context-health-phase-header"
                        onClick={() => hasCalls && toggleExpand(phaseKey)}
                        disabled={!hasCalls}
                        aria-expanded={hasCalls ? isExpanded : undefined}
                      >
                        <div className="context-health-phase-title-group">
                          {hasCalls ? (
                            isExpanded ? (
                              <ChevronDown size={14} color="var(--text-muted)" />
                            ) : (
                              <ChevronRight size={14} color="var(--text-muted)" />
                            )
                          ) : (
                            <span style={{ width: 14, display: "inline-block" }} />
                          )}
                          <div>
                            <div className="context-health-phase-title">
                              {meta.title}
                              {summary && summary.call_count > 1 && (
                                <span className="context-health-call-count">
                                  {summary.call_count} calls
                                </span>
                              )}
                              {isPending && (
                                <span className="context-health-call-count">running…</span>
                              )}
                            </div>
                            <div className="context-health-phase-subtitle">{meta.subtitle}</div>
                          </div>
                        </div>

                        <div className="context-health-phase-metric">
                          {phaseStatus === "idle" ? (
                            <span className="context-health-muted">Skipped / Idle</span>
                          ) : pct != null && summary?.context_ceiling ? (
                            <>
                              <strong style={{ color: phaseColor }}>
                                {pct.toFixed(1)}%
                              </strong>
                              <span className="context-health-muted">
                                {formatTokenCount(summary.peak_prompt_tokens)} /{" "}
                                {formatTokenCount(summary.context_ceiling)} tok
                              </span>
                            </>
                          ) : (
                            <>
                              <strong style={{ color: phaseColor }}>
                                {formatTokenCount(summary?.peak_prompt_tokens ?? 0)} tok
                              </strong>
                              <span className="context-health-muted">limit unknown</span>
                            </>
                          )}
                        </div>
                      </button>

                      <div className="context-health-bar-track">
                        <div
                          className={`context-health-bar-fill${isOverflow ? " is-overflow" : ""}`}
                          style={{
                            width: `${visualWidth}%`,
                            background: phaseColor,
                          }}
                        />
                      </div>

                      {summary?.cropped_summary && (
                        <div
                          className="context-health-callout"
                          style={{ color: "var(--accent-rose)" }}
                        >
                          <strong>Cropping / Truncation:</strong> {summary.cropped_summary}
                        </div>
                      )}

                      {summary?.dropped_summary && (
                        <div
                          className="context-health-callout"
                          style={{ color: "var(--accent-amber)" }}
                        >
                          <strong>Context Trimmed:</strong> {summary.dropped_summary}
                        </div>
                      )}

                      {phaseKey === "phase4_prose" && summary?.budget_report && (
                        <ZoneBreakdownBar
                          report={summary.budget_report}
                          completionTokens={summary.total_completion_tokens}
                        />
                      )}

                      {isExpanded && summary && summary.calls.length > 0 && (
                        <div className="context-health-subcalls">
                          <table>
                            <thead>
                              <tr>
                                <th>Call</th>
                                <th>Model</th>
                                <th>Prompt</th>
                                <th>Output</th>
                                <th>Stop</th>
                                <th>Source</th>
                              </tr>
                            </thead>
                            <tbody>
                              {summary.calls.map((c, idx) => (
                                <tr key={`${c.label}-${idx}`}>
                                  <td>
                                    {c.label}
                                    {c.retries > 0 && (
                                      <span className="context-health-muted">
                                        {" "}
                                        ({c.retries} retry)
                                      </span>
                                    )}
                                    {c.error && (
                                      <span
                                        title={c.error}
                                        style={{ color: "var(--accent-amber)", marginLeft: 4 }}
                                      >
                                        ⚠
                                      </span>
                                    )}
                                  </td>
                                  <td className="context-health-mono">{c.model || "—"}</td>
                                  <td>{formatTokenCount(c.prompt_tokens)}</td>
                                  <td>{formatTokenCount(c.completion_tokens)}</td>
                                  <td
                                    style={
                                      c.finish_reason === "length"
                                        ? { color: "var(--accent-rose)", fontWeight: 600 }
                                        : undefined
                                    }
                                  >
                                    {c.finish_reason}
                                  </td>
                                  <td>{c.usage_source === "exact" ? "Exact" : "Est."}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
