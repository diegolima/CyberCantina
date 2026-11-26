import React, { useEffect, useRef, useState } from "react";
import { DoorOpen, X } from "lucide-react";
import { useModalDialog } from "../../hooks/useModalDialog";
import type {
  CompassDirection,
  LocationContainer,
  LocationEdge,
  LocationNode,
} from "../../types";
import { TargetEdgeSelector } from "./TargetEdgeSelector";
import {
  DEFAULT_EXTERIOR_DISTANCE_METERS,
  clampEdgeDistanceMeters,
  computePromotionCandidates,
  formatWalkingDuration,
  getLocationOccupiedPorts,
  parseCommittedEdgeDistance,
  sanitizeEdgeDistanceInput,
  type PromotionPromptState,
} from "./topologyProjection";

export interface PortalPromotionModalProps {
  promotionPrompt: PromotionPromptState | null;
  containerMap: Map<string, LocationContainer>;
  dynamicPortalIds: Set<string>;
  edges?: LocationEdge[];
  locationMap?: Map<string, LocationNode>;
  onChangePrompt: (next: PromotionPromptState | null) => void;
  onConfirm: (
    fromLoc: LocationNode,
    toLoc: LocationNode,
    direction: CompassDirection,
    distanceMeters: number,
    bidirectional: boolean,
    promoteIds: Set<string>,
    explicitTargetSlot?: CompassDirection
  ) => void;
}

export const PortalPromotionModal: React.FC<PortalPromotionModalProps> = ({
  promotionPrompt,
  containerMap,
  dynamicPortalIds,
  edges = [],
  locationMap = new Map(),
  onChangePrompt,
  onConfirm,
}) => {
  const [distanceDraft, setDistanceDraft] = useState(
    String(DEFAULT_EXTERIOR_DISTANCE_METERS)
  );
  const promptMeters = promotionPrompt?.distanceMeters;

  useEffect(() => {
    if (promptMeters !== undefined) {
      setDistanceDraft(
        String(
          clampEdgeDistanceMeters(
            promptMeters,
            DEFAULT_EXTERIOR_DISTANCE_METERS
          )
        )
      );
    }
  }, [promptMeters]);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  useModalDialog({
    isOpen: Boolean(promotionPrompt),
    onClose: () => onChangePrompt(null),
    dialogRef,
  });

  if (!promotionPrompt) return null;
  const setPromotionPrompt = onChangePrompt;
  const resolvedMeters =
    parseCommittedEdgeDistance(distanceDraft) ??
    clampEdgeDistanceMeters(
      promotionPrompt.distanceMeters,
      DEFAULT_EXTERIOR_DISTANCE_METERS
    );
  const projectedTopology = { dynamicPortalIds };
  const occupiedPorts = getLocationOccupiedPorts(
    promotionPrompt.toLocation.id,
    edges,
    locationMap
  );

  return (
            <div
              ref={dialogRef}
              className="map-inner-dialog-backdrop"
              role="dialog"
              aria-modal="true"
              aria-label="Container Connection & Portal Setup"
              tabIndex={-1}
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
                setPromotionPrompt(null);
              }}
            >
              <div
                style={{
                  width: "min(460px, 95%)",
                  background: "var(--bg-card)",
                  border: "1px solid rgba(6, 182, 212, 0.55)",
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
                    fontSize: "0.88rem",
                    fontWeight: 700,
                    color: "var(--accent-cyan)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 7,
                  }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    <DoorOpen size={16} />
                    {promotionPrompt.candidates.length > 0
                      ? "Cross-Boundary Connection & Portal Setup"
                      : "Connect to Container Target"}
                  </span>
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "2px 6px" }}
                    onClick={() => setPromotionPrompt(null)}
                    aria-label="Close"
                  >
                    <X size={13} />
                  </button>
                </div>

                <div style={{ fontSize: "0.76rem", color: "var(--text-secondary)" }}>
                  Connecting{" "}
                  <strong>{promotionPrompt.fromLocation.name}</strong>{" "}
                  <span style={{ color: "var(--accent-cyan)" }}>
                    [{promotionPrompt.direction}]
                  </span>{" "}
                  → <strong>{promotionPrompt.toLocation.name}</strong>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: promotionPrompt.targetContainerForLocationPick
                      ? "1fr 90px"
                      : "1fr",
                    gap: 8,
                    alignItems: "end",
                  }}
                >
                  {promotionPrompt.targetContainerForLocationPick && (
                    <div className="field-group" style={{ gap: 4 }}>
                      <label style={{ fontSize: "0.74rem", fontWeight: 600 }}>
                        Target Location Inside{" "}
                        {promotionPrompt.targetContainerForLocationPick.name}
                      </label>
                      <select
                        className="field-select"
                        value={promotionPrompt.chosenTargetLocationId}
                        onChange={(e) => {
                          const picked =
                            promotionPrompt.targetLocationCandidates.find(
                              (r) => r.id === e.target.value
                            ) ?? promotionPrompt.toLocation;
                          setPromotionPrompt({
                            ...promotionPrompt,
                            toLocation: picked,
                            chosenTargetLocationId: picked.id,
                            candidates: computePromotionCandidates(
                              promotionPrompt.fromLocation,
                              picked,
                              containerMap,
                              projectedTopology.dynamicPortalIds
                            ),
                          });
                        }}
                      >
                        {promotionPrompt.targetLocationCandidates.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                            {projectedTopology.dynamicPortalIds.has(r.id)
                              ? " [Portal]"
                              : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="field-group" style={{ gap: 4 }}>
                    <label style={{ fontSize: "0.72rem" }}>
                      Distance (m) · {formatWalkingDuration(resolvedMeters)}
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="field-input"
                      placeholder="e.g. 100 or 1.5km"
                      value={distanceDraft}
                      onChange={(e) => {
                        const sanitized = sanitizeEdgeDistanceInput(e.target.value);
                        setDistanceDraft(sanitized);
                        const parsed = parseCommittedEdgeDistance(sanitized);
                        if (parsed !== null) {
                          setPromotionPrompt({
                            ...promotionPrompt,
                            distanceMeters: parsed,
                          });
                        }
                      }}
                    />
                  </div>
                </div>

                <TargetEdgeSelector
                  sourceSlot={promotionPrompt.direction}
                  targetName={promotionPrompt.toLocation.name}
                  selectedSlot={promotionPrompt.explicitTargetSlot}
                  occupiedPorts={occupiedPorts}
                  onChange={(slot) =>
                    setPromotionPrompt({
                      ...promotionPrompt,
                      explicitTargetSlot: slot,
                    })
                  }
                />

                {promotionPrompt.candidates.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 7,
                      fontSize: "0.76rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <div>
                      Crossing a Level 1 container boundary — mark interior
                      location(s) as Entry/Exit Portals:
                    </div>
                    {promotionPrompt.candidates.map((cand) => (
                      <label
                        key={cand.location.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          background: "var(--bg-panel)",
                          padding: "6px 9px",
                          borderRadius: 6,
                          border: "1px solid var(--border-subtle)",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={cand.promote}
                          onChange={(e) =>
                            setPromotionPrompt({
                              ...promotionPrompt,
                              candidates: promotionPrompt.candidates.map((c) =>
                                c.location.id === cand.location.id
                                  ? { ...c, promote: e.target.checked }
                                  : c
                              ),
                            })
                          }
                        />
                        <span>
                          Promote <strong>{cand.location.name}</strong> to{" "}
                          <span style={{ color: "var(--accent-cyan)" }}>
                            [Entry/Exit Portal]
                          </span>{" "}
                          for {cand.container.name}
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 8,
                    marginTop: 4,
                  }}
                >
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "4px 10px", fontSize: "0.74rem" }}
                    onClick={() => setPromotionPrompt(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-cyan"
                    style={{ padding: "4px 12px", fontSize: "0.74rem" }}
                    onClick={() =>
                      onConfirm(
                        promotionPrompt.fromLocation,
                        promotionPrompt.toLocation,
                        promotionPrompt.direction,
                        resolvedMeters,
                        promotionPrompt.bidirectional,
                        new Set(
                          promotionPrompt.candidates
                            .filter((c) => c.promote)
                            .map((c) => c.location.id)
                        ),
                        promotionPrompt.explicitTargetSlot
                      )
                    }
                  >
                    Confirm &amp; Connect
                  </button>
                </div>
              </div>
            </div>
  );
};
