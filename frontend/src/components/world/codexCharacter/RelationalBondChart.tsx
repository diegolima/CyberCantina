import React, { useEffect, useMemo, useState } from "react";
import {
  RELATIONAL_METRICS,
  type RelationalHistoryPoint,
  type RelationalMetricKey,
  computeSparseTickIndices,
  formatMetricValue,
  mapValueToChartY,
  sliceBondHistoryWindow,
} from "./relationalHistory";

export interface RelationalBondChartProps {
  targetLabel: string;
  points: readonly RelationalHistoryPoint[];
  initialEnabledMetrics?: readonly RelationalMetricKey[];
}

const SVG_W = 460;
const SVG_H = 176;
const PLOT_LEFT = 36;
const PLOT_RIGHT = 446;
const PLOT_TOP = 14;
const PLOT_BOTTOM = 148;
const PLOT_W = PLOT_RIGHT - PLOT_LEFT;
const PLOT_H = PLOT_BOTTOM - PLOT_TOP;

export const RelationalBondChart: React.FC<RelationalBondChartProps> = ({
  targetLabel,
  points,
  initialEnabledMetrics,
}) => {
  const [enabledMetrics, setEnabledMetrics] = useState<Set<RelationalMetricKey>>(
    () =>
      new Set(
        initialEnabledMetrics ??
          RELATIONAL_METRICS.filter((m) => m.defaultEnabled).map((m) => m.key)
      )
  );
  const [windowMode, setWindowMode] = useState<"all" | "last25">("all");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const visiblePoints = useMemo(
    () => sliceBondHistoryWindow(points, windowMode),
    [points, windowMode]
  );

  useEffect(() => {
    setSelectedIndex(null);
  }, [points, windowMode]);

  const activeIdx =
    visiblePoints.length === 0
      ? -1
      : selectedIndex !== null &&
        selectedIndex >= 0 &&
        selectedIndex < visiblePoints.length
      ? selectedIndex
      : visiblePoints.length - 1;

  const activePoint = activeIdx >= 0 ? visiblePoints[activeIdx] : null;
  const enabledList = useMemo(
    () => RELATIONAL_METRICS.filter((m) => enabledMetrics.has(m.key)),
    [enabledMetrics]
  );

  const toggleMetric = (key: RelationalMetricKey) => {
    setEnabledMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const getPointX = (idx: number): number => {
    if (visiblePoints.length <= 1) {
      return PLOT_LEFT + PLOT_W / 2;
    }
    return PLOT_LEFT + (idx / (visiblePoints.length - 1)) * PLOT_W;
  };

  const tickIndices = useMemo(
    () => computeSparseTickIndices(visiblePoints.length, 6),
    [visiblePoints.length]
  );

  const yTop = mapValueToChartY(1, PLOT_TOP, PLOT_H);
  const yZero = mapValueToChartY(0, PLOT_TOP, PLOT_H);
  const yBottom = mapValueToChartY(-1, PLOT_TOP, PLOT_H);
  const hitWidth =
    visiblePoints.length <= 1
      ? PLOT_W
      : PLOT_W / Math.max(1, visiblePoints.length - 1);

  return (
    <div
      className="codex-bond-chart-wrap"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Toolbar: Legend toggles + Window selector */}
      <div className="codex-chart-toolbar">
        <div className="codex-chart-legend" role="group" aria-label="Relational metrics">
          {RELATIONAL_METRICS.map((metric) => {
            const isOn = enabledMetrics.has(metric.key);
            return (
              <button
                key={metric.key}
                type="button"
                aria-pressed={isOn}
                className={`codex-chart-pill ${isOn ? "active" : ""}`}
                onClick={() => toggleMetric(metric.key)}
                title={
                  metric.isPercent
                    ? `Toggle ${metric.label} (0%–100% plotted in upper half)`
                    : `Toggle ${metric.label} (-1.0 to +1.0)`
                }
              >
                <span
                  className="codex-chart-swatch"
                  style={{
                    backgroundColor: metric.color,
                    opacity: isOn ? 1 : 0.4,
                  }}
                />
                <span>{metric.label}</span>
              </button>
            );
          })}
        </div>

        {points.length > 25 && (
          <div className="codex-chart-window-toggle" role="group" aria-label="Turn window">
            <button
              type="button"
              className={`codex-chart-pill ${windowMode === "all" ? "active" : ""}`}
              aria-pressed={windowMode === "all"}
              onClick={() => setWindowMode("all")}
            >
              All ({points.length})
            </button>
            <button
              type="button"
              className={`codex-chart-pill ${windowMode === "last25" ? "active" : ""}`}
              aria-pressed={windowMode === "last25"}
              onClick={() => setWindowMode("last25")}
            >
              Last 25
            </button>
          </div>
        )}
      </div>

      {/* Inline SVG Chart */}
      {visiblePoints.length === 0 ? (
        <div className="codex-muted-note">
          No historical turns recorded for this bond yet.
        </div>
      ) : enabledList.length === 0 ? (
        <div className="codex-bond-chart-empty">
          Select one or more metrics above to plot relational lines.
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          className="codex-chart-svg"
          role="img"
          aria-label={`Relational history with ${targetLabel}`}
        >
          {/* Horizontal reference gridlines (+1, 0, -1) */}
          <line
            x1={PLOT_LEFT}
            y1={yTop}
            x2={PLOT_RIGHT}
            y2={yTop}
            stroke="var(--border-subtle)"
            strokeWidth={1}
          />
          <line
            x1={PLOT_LEFT}
            y1={yZero}
            x2={PLOT_RIGHT}
            y2={yZero}
            stroke="var(--text-muted)"
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.7}
          />
          <line
            x1={PLOT_LEFT}
            y1={yBottom}
            x2={PLOT_RIGHT}
            y2={yBottom}
            stroke="var(--border-subtle)"
            strokeWidth={1}
          />

          {/* Y-axis labels */}
          <text
            x={PLOT_LEFT - 6}
            y={yTop + 3}
            textAnchor="end"
            fontSize={9.5}
            fill="var(--text-muted)"
          >
            +1
          </text>
          <text
            x={PLOT_LEFT - 6}
            y={yZero + 3}
            textAnchor="end"
            fontSize={9.5}
            fill="var(--text-muted)"
          >
            0
          </text>
          <text
            x={PLOT_LEFT - 6}
            y={yBottom + 3}
            textAnchor="end"
            fontSize={9.5}
            fill="var(--text-muted)"
          >
            -1
          </text>

          {/* Vertical active crosshair */}
          {activeIdx >= 0 && (
            <line
              x1={getPointX(activeIdx)}
              y1={PLOT_TOP}
              x2={getPointX(activeIdx)}
              y2={PLOT_BOTTOM}
              stroke="var(--text-secondary)"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.65}
            />
          )}

          {/* Metric polylines and data point markers */}
          {enabledList.map((metric) => {
            const coords = visiblePoints.map((pt, idx) => ({
              x: getPointX(idx),
              y: mapValueToChartY(pt[metric.key], PLOT_TOP, PLOT_H),
            }));
            const polyPoints = coords
              .map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`)
              .join(" ");

            return (
              <g key={metric.key}>
                {coords.length > 1 && (
                  <polyline
                    fill="none"
                    stroke={metric.color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={metric.dashed ? "4 3" : undefined}
                    points={polyPoints}
                  />
                )}
                {coords.map((c, idx) => {
                  const isFocused = idx === activeIdx;
                  const radius =
                    coords.length === 1 ? 4.2 : isFocused ? 4 : 2.3;
                  return (
                    <circle
                      key={`${metric.key}-${idx}`}
                      cx={c.x}
                      cy={c.y}
                      r={radius}
                      fill={metric.color}
                      stroke={isFocused ? "var(--bg-deep)" : "none"}
                      strokeWidth={isFocused ? 1.4 : 0}
                    />
                  );
                })}
              </g>
            );
          })}

          {/* Sparse X-axis Turn ticks */}
          {tickIndices.map((idx) => {
            const pt = visiblePoints[idx];
            if (!pt) return null;
            return (
              <text
                key={`tick-${pt.turnId}-${idx}`}
                x={getPointX(idx)}
                y={SVG_H - 8}
                textAnchor="middle"
                fontSize={9.5}
                fill="var(--text-muted)"
              >
                #{pt.depthIndex}
              </text>
            );
          })}

          {/* Wide transparent column hit targets for hover/click/focus */}
          {visiblePoints.map((pt, idx) => {
            const cx = getPointX(idx);
            const rawX = cx - hitWidth / 2;
            const rectX = Math.max(PLOT_LEFT, rawX);
            const rectRight = Math.min(PLOT_RIGHT, cx + hitWidth / 2);
            const rectW = Math.max(10, rectRight - rectX);
            return (
              <rect
                key={`hit-${pt.turnId}-${idx}`}
                x={rectX}
                y={PLOT_TOP}
                width={rectW}
                height={PLOT_H}
                fill="transparent"
                style={{ cursor: "pointer" }}
                tabIndex={0}
                aria-label={`Inspect Turn #${pt.depthIndex} with ${targetLabel}`}
                onMouseEnter={() => setSelectedIndex(idx)}
                onClick={() => setSelectedIndex(idx)}
                onFocus={() => setSelectedIndex(idx)}
              />
            );
          })}
        </svg>
      )}

      {visiblePoints.length === 1 && enabledList.length > 0 && (
        <div className="codex-muted-note">
          1 turn recorded — shifts will chart as the campaign progresses.
        </div>
      )}

      {/* HTML Readout Bar */}
      {activePoint && enabledList.length > 0 && (
        <div className="codex-chart-readout">
          <div className="codex-chart-readout-head">
            <span className="badge codex-badge--muted">
              Turn #{activePoint.depthIndex}
            </span>
            <div className="codex-chart-readout-metrics">
              {enabledList.map((metric) => (
                <span key={metric.key} className="codex-chart-readout-item">
                  <span
                    className="codex-chart-swatch"
                    style={{ backgroundColor: metric.color }}
                  />
                  <span>{metric.label}:</span>
                  <strong>
                    {formatMetricValue(metric, activePoint[metric.key])}
                  </strong>
                </span>
              ))}
            </div>
          </div>
          {activePoint.episodicNote && (
            <div className="codex-chart-readout-note">
              {activePoint.episodicNote}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
