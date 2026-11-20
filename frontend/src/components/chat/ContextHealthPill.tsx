import React from "react";
import type { TurnTelemetry } from "../../types";
import {
  TELEMETRY_PHASE_ORDER,
  buildContextHealthTooltip,
  getHealthStatusColor,
  getHealthStatusLabel,
  getMicroBarHeightPct,
  getPhaseSummary,
} from "./contextHealthHelpers";

interface ContextHealthPillProps {
  telemetry: TurnTelemetry | null;
  onClick: () => void;
}

export const ContextHealthPill: React.FC<ContextHealthPillProps> = ({
  telemetry,
  onClick,
}) => {
  const status = telemetry?.overall_status ?? "idle";
  const label = getHealthStatusLabel(status);
  const statusColor = getHealthStatusColor(status);
  const tooltip = buildContextHealthTooltip(telemetry);
  const phase5Pending = Boolean(telemetry?.phase5_pending);

  return (
    <button
      type="button"
      className={`context-health-pill context-health-${status}`}
      onClick={onClick}
      title={tooltip}
      aria-label={`Context Health: ${label}. Click to inspect per-phase token usage.`}
    >
      <span
        className="context-health-dot"
        style={{ background: statusColor }}
        aria-hidden="true"
      />
      <span className="context-health-label">{label}</span>
      <span className="context-health-microbars" aria-hidden="true">
        {TELEMETRY_PHASE_ORDER.map((phaseKey) => {
          const summary = getPhaseSummary(telemetry, phaseKey);
          const phaseStatus = summary?.status ?? "idle";
          const fillPct = getMicroBarHeightPct(summary);
          const fillColor = getHealthStatusColor(phaseStatus);
          const isPulsing = phaseKey === "phase5_clerk" && phase5Pending;

          return (
            <span
              key={phaseKey}
              className={`context-health-microbar-track${isPulsing ? " is-pending" : ""}`}
            >
              <span
                className="context-health-microbar-fill"
                style={{
                  height: `${fillPct}%`,
                  background: fillColor,
                  opacity: phaseStatus === "idle" ? 0.35 : 0.95,
                }}
              />
            </span>
          );
        })}
      </span>
    </button>
  );
};
