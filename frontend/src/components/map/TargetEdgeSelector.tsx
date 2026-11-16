import React from "react";
import { Compass } from "lucide-react";
import type { CompassDirection } from "../../types";
import { COMPASS_ORDER, resolveAutoTargetSlot } from "./topologyProjection";

export interface TargetEdgeSelectorProps {
  sourceSlot: CompassDirection;
  targetName: string;
  selectedSlot?: CompassDirection;
  occupiedPorts: Map<CompassDirection, string>;
  onChange: (slot: CompassDirection | undefined) => void;
}

/**
 * Optional compass port selector for the destination end of a new bidirectional link.
 * Leaving Auto selected resolves the nearest free compass port around the opposite direction.
 */
export const TargetEdgeSelector: React.FC<TargetEdgeSelectorProps> = ({
  sourceSlot,
  targetName,
  selectedSlot,
  occupiedPorts,
  onChange,
}) => {
  const occupiedSet = new Set(occupiedPorts.keys());
  const autoResolution = resolveAutoTargetSlot(sourceSlot, occupiedSet);
  const activeResolution = resolveAutoTargetSlot(
    sourceSlot,
    occupiedSet,
    selectedSlot
  );
  const collidingDest = activeResolution.collides
    ? occupiedPorts.get(activeResolution.slot) ?? "another location"
    : null;

  return (
    <div
      className="field-group"
      style={{
        gap: 5,
        background: "rgba(15, 23, 42, 0.55)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 6,
        padding: "8px 9px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: "0.73rem",
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          <Compass size={12} color="#38bdf8" />
          Target Edge on &ldquo;{targetName}&rdquo;{" "}
          <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
            (optional)
          </span>
        </span>
        <button
          type="button"
          className="btn"
          onClick={() => onChange(undefined)}
          aria-pressed={selectedSlot === undefined}
          style={{
            padding: "2px 8px",
            fontSize: "0.69rem",
            borderColor:
              selectedSlot === undefined ? "#22d3ee" : "var(--border-subtle)",
            background:
              selectedSlot === undefined
                ? "rgba(6, 182, 212, 0.18)"
                : "var(--bg-panel)",
            color:
              selectedSlot === undefined ? "#67e8f9" : "var(--text-secondary)",
            fontWeight: selectedSlot === undefined ? 600 : 500,
          }}
        >
          Auto ({autoResolution.slot}
          {autoResolution.isFallback ? " · free" : ""})
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(8, minmax(0, 1fr))",
          gap: 4,
        }}
      >
        {COMPASS_ORDER.map((slot) => {
          const occupiedBy = occupiedPorts.get(slot);
          const isSelected = selectedSlot === slot;
          return (
            <button
              key={slot}
              type="button"
              className="btn"
              onClick={() => onChange(isSelected ? undefined : slot)}
              aria-pressed={isSelected}
              title={
                occupiedBy
                  ? `${slot} — occupied by ${occupiedBy}`
                  : `${slot} — available`
              }
              style={{
                justifyContent: "center",
                padding: "4px 2px",
                fontSize: "0.69rem",
                fontWeight: isSelected ? 700 : 500,
                borderColor: isSelected
                  ? occupiedBy
                    ? "#c084fc"
                    : "#22d3ee"
                  : occupiedBy
                  ? "rgba(245, 158, 11, 0.35)"
                  : "var(--border-subtle)",
                background: isSelected
                  ? occupiedBy
                    ? "rgba(168, 85, 247, 0.2)"
                    : "rgba(6, 182, 212, 0.2)"
                  : occupiedBy
                  ? "rgba(245, 158, 11, 0.08)"
                  : "var(--bg-panel)",
                color: isSelected
                  ? occupiedBy
                    ? "#e9d5ff"
                    : "#67e8f9"
                  : occupiedBy
                  ? "#fbbf24"
                  : "var(--text-secondary)",
              }}
            >
              {slot}
              {occupiedBy ? "•" : ""}
            </button>
          );
        })}
      </div>

      <div
        style={{
          fontSize: "0.68rem",
          color: collidingDest ? "#e9d5ff" : "var(--text-muted)",
          lineHeight: 1.35,
        }}
      >
        {collidingDest ? (
          <>
            Port <strong>[{activeResolution.slot}]</strong> is currently connected
            to <strong>{collidingDest}</strong> — confirming will offer a Passage
            Hub.
          </>
        ) : selectedSlot === undefined ? (
          <>
            Auto resolves to <strong>[{autoResolution.slot}]</strong>
            {autoResolution.isFallback
              ? " (nearest free compass port)."
              : " (opposite of source port)."}
          </>
        ) : (
          <>
            Will attach return edge on <strong>[{selectedSlot}]</strong> (click
            again to reset to Auto).
          </>
        )}
      </div>
    </div>
  );
};
