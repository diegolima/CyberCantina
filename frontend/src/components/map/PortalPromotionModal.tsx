import React from "react";
import { DoorOpen } from "lucide-react";
import type {
  CompassDirection,
  LocationContainer,
  LocationNode,
} from "../../types";
import {
  computePromotionCandidates,
  type PromotionPromptState,
} from "./topologyProjection";

export interface PortalPromotionModalProps {
  promotionPrompt: PromotionPromptState | null;
  containerMap: Map<string, LocationContainer>;
  dynamicPortalIds: Set<string>;
  onChangePrompt: (next: PromotionPromptState | null) => void;
  onConfirm: (
    fromLoc: LocationNode,
    toLoc: LocationNode,
    direction: CompassDirection,
    travelMinutes: number,
    bidirectional: boolean,
    promoteIds: Set<string>
  ) => void;
}

export const PortalPromotionModal: React.FC<PortalPromotionModalProps> = ({
  promotionPrompt,
  containerMap,
  dynamicPortalIds,
  onChangePrompt,
  onConfirm,
}) => {
  if (!promotionPrompt) return null;
  const setPromotionPrompt = onChangePrompt;
  const executeDirectEdgeCreation = onConfirm;
  const projectedTopology = { dynamicPortalIds };

  return (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Entry/Exit Portal Promotion"
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
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  width: "min(440px, 95%)",
                  background: "var(--bg-card)",
                  border: "1px solid rgba(6, 182, 212, 0.55)",
                  borderRadius: 8,
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    fontSize: "0.88rem",
                    fontWeight: 700,
                    color: "var(--accent-cyan)",
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                  }}
                >
                  <DoorOpen size={16} />
                  Cross-Boundary Connection &amp; Portal Setup
                </div>

                {promotionPrompt.targetContainerForLocationPick && (
                  <div className="field-group" style={{ gap: 4 }}>
                    <label style={{ fontSize: "0.74rem", fontWeight: 600 }}>
                      Select Target Location Inside{" "}
                      {promotionPrompt.targetContainerForLocationPick.name}:
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
                      Connecting{" "}
                      <strong>{promotionPrompt.fromLocation.name}</strong> →{" "}
                      <strong>{promotionPrompt.toLocation.name}</strong> crosses a
                      Level 1 container boundary. Mark interior location(s) as
                      Entry/Exit Portals:
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
                      executeDirectEdgeCreation(
                        promotionPrompt.fromLocation,
                        promotionPrompt.toLocation,
                        promotionPrompt.direction,
                        promotionPrompt.travelMinutes,
                        promotionPrompt.bidirectional,
                        new Set(
                          promotionPrompt.candidates
                            .filter((c) => c.promote)
                            .map((c) => c.location.id)
                        )
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
