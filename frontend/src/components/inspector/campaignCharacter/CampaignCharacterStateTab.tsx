import React from "react";
import {
  Activity,
  Brain,
  Clock,
  HeartPulse,
  MapPin,
  Users,
} from "lucide-react";
import {
  CharacterRecord,
  CharacterStateSnapshot,
} from "../../../types";

export interface CampaignCharacterStateTabProps {
  character: CharacterRecord;
  state: CharacterStateSnapshot;
  isPresent: boolean;
  elsewhereLocationName?: string;
  characterNameMap: Record<string, string>;
  isActive: boolean;
}

export const CampaignCharacterStateTab: React.FC<CampaignCharacterStateTabProps> = ({
  character,
  state,
  isPresent,
  elsewhereLocationName,
  characterNameMap,
  isActive,
}) => {
  const valencePct = Math.round(((state.valence + 1) / 2) * 100);
  const arousalPct = Math.round(state.arousal * 100);
  const care = state.care_state ?? null;
  const activeEmotion = care?.active_emotion ?? "default";
  const dominancePct = care ? Math.round(((care.dominance + 1) / 2) * 100) : 50;
  const composurePct = care ? Math.round(care.composure * 100) : 82;
  const relationships = Object.entries(state.relationship_notes || {});

  return (
          <div
            style={{
              display: isActive ? "flex" : "none",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {/* Status & Emotional Overview Banner */}
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    className="badge"
                    style={{
                      background: isPresent
                        ? "rgba(16, 185, 129, 0.15)"
                        : "rgba(168, 85, 247, 0.15)",
                      borderColor: isPresent
                        ? "rgba(16, 185, 129, 0.4)"
                        : "rgba(168, 85, 247, 0.4)",
                      color: isPresent ? "#6ee7b7" : "#c084fc",
                    }}
                  >
                    <MapPin size={11} style={{ marginRight: 4 }} />
                    {isPresent
                      ? "Present in Active Scene"
                      : `Elsewhere: ${elsewhereLocationName || "Unknown"}`}
                  </span>
                  <span
                    className="badge"
                    style={{
                      background: "rgba(245, 158, 11, 0.15)",
                      borderColor: "rgba(245, 158, 11, 0.4)",
                      color: "var(--accent-amber)",
                    }}
                  >
                    Mood: {state.mood_label || "Neutral"}
                  </span>
                  {activeEmotion !== "default" && (
                    <span
                      className="badge"
                      style={{ textTransform: "capitalize" }}
                    >
                      Expression: {activeEmotion}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: "0.72rem",
                    color: "var(--text-muted)",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Clock size={12} />
                  Turn ID: {state.turn_id}
                </div>
              </div>

              {care?.outward_demeanor && (
                <div
                  style={{
                    fontSize: "0.78rem",
                    color: "var(--text-secondary)",
                    fontStyle: "italic",
                    background: "var(--bg-panel)",
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <strong>Outward Demeanor:</strong> {care.outward_demeanor}
                </div>
              )}

              {/* Layer 2: PAD + Composure Emotional Meters */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginTop: 4,
                }}
              >
                <div className="meter-row">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "0.73rem",
                      marginBottom: 4,
                    }}
                  >
                    <span>Valence (Distressed ↔ Warm)</span>
                    <span style={{ fontWeight: 600 }}>
                      {state.valence >= 0
                        ? `+${state.valence.toFixed(2)}`
                        : state.valence.toFixed(2)}
                    </span>
                  </div>
                  <div className="meter-track">
                    <div
                      className="meter-fill"
                      style={{
                        width: `${valencePct}%`,
                        background:
                          state.valence >= 0
                            ? "var(--accent-emerald)"
                            : "var(--accent-rose)",
                      }}
                    />
                  </div>
                </div>

                <div className="meter-row">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: "0.73rem",
                      marginBottom: 4,
                    }}
                  >
                    <span>Arousal / Tension</span>
                    <span style={{ fontWeight: 600 }}>{state.arousal.toFixed(2)}</span>
                  </div>
                  <div className="meter-track">
                    <div
                      className="meter-fill"
                      style={{
                        width: `${arousalPct}%`,
                        background: "var(--accent-amber)",
                      }}
                    />
                  </div>
                </div>

                {care && (
                  <>
                    <div className="meter-row">
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: "0.73rem",
                          marginBottom: 4,
                        }}
                      >
                        <span>Dominance (Cornered ↔ Commanding)</span>
                        <span style={{ fontWeight: 600 }}>
                          {care.dominance >= 0
                            ? `+${care.dominance.toFixed(2)}`
                            : care.dominance.toFixed(2)}
                        </span>
                      </div>
                      <div className="meter-track">
                        <div
                          className="meter-fill"
                          style={{
                            width: `${dominancePct}%`,
                            background: "var(--accent-cyan)",
                          }}
                        />
                      </div>
                    </div>

                    <div className="meter-row">
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: "0.73rem",
                          marginBottom: 4,
                        }}
                      >
                        <span>Composure &amp; Emotional Mask</span>
                        <span style={{ fontWeight: 600 }}>{composurePct}%</span>
                      </div>
                      <div className="meter-track">
                        <div
                          className="meter-fill"
                          style={{
                            width: `${composurePct}%`,
                            background:
                              care.composure >= 0.45
                                ? "#a78bfa"
                                : "var(--accent-rose)",
                          }}
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Layer 3 & Layer 1: Situational Appraisal & Active Worldview */}
            {care && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 8,
                    padding: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div className="sidebar-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Brain size={13} color="var(--accent-amber)" />
                    Layer 3 · Scene Appraisal
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: "0.74rem" }}>
                    <div>
                      <span style={{ color: "var(--text-muted)" }}>Threat: </span>
                      <strong>{Math.round(care.appraisal.threat * 100)}%</strong>
                    </div>
                    <div>
                      <span style={{ color: "var(--text-muted)" }}>Coping: </span>
                      <strong>
                        {care.appraisal.coping >= 0
                          ? `+${care.appraisal.coping.toFixed(2)}`
                          : care.appraisal.coping.toFixed(2)}
                      </strong>
                    </div>
                    <div>
                      <span style={{ color: "var(--text-muted)" }}>Goal Fit: </span>
                      <strong>
                        {care.appraisal.goal_congruence >= 0
                          ? `+${care.appraisal.goal_congruence.toFixed(2)}`
                          : care.appraisal.goal_congruence.toFixed(2)}
                      </strong>
                    </div>
                    <div>
                      <span style={{ color: "var(--text-muted)" }}>Surprise: </span>
                      <strong>{Math.round(care.appraisal.ambiguity * 100)}%</strong>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 8,
                    padding: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div className="sidebar-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <HeartPulse size={13} color="#ec4899" />
                    Layer 1 · Active Worldview
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: "0.74rem" }}>
                    <div>
                      <div style={{ color: "var(--text-muted)", fontSize: "0.69rem" }}>Benevolence</div>
                      <strong>
                        {care.active_worldview.benevolence >= 0
                          ? `+${care.active_worldview.benevolence.toFixed(2)}`
                          : care.active_worldview.benevolence.toFixed(2)}
                      </strong>
                    </div>
                    <div>
                      <div style={{ color: "var(--text-muted)", fontSize: "0.69rem" }}>Belonging</div>
                      <strong>
                        {care.active_worldview.belonging >= 0
                          ? `+${care.active_worldview.belonging.toFixed(2)}`
                          : care.active_worldview.belonging.toFixed(2)}
                      </strong>
                    </div>
                    <div>
                      <div style={{ color: "var(--text-muted)", fontSize: "0.69rem" }}>Agency</div>
                      <strong>
                        {care.active_worldview.agency >= 0
                          ? `+${care.active_worldview.agency.toFixed(2)}`
                          : care.active_worldview.agency.toFixed(2)}
                      </strong>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Active Scene Want */}
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div
                className="sidebar-label"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 6,
                }}
              >
                <Activity size={13} color="var(--accent-emerald)" />
                Active Scene Want
              </div>
              <div
                style={{
                  fontSize: "0.82rem",
                  lineHeight: 1.5,
                  color: "var(--text-primary)",
                  background: "var(--bg-panel)",
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--border-subtle)",
                }}
              >
                {state.active_want || (
                  <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                    Observing the scene carefully.
                  </span>
                )}
              </div>
            </div>

            {/* Active Tactical Plan */}
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div
                className="sidebar-label"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 6,
                }}
              >
                <Activity size={13} color="var(--accent-cyan)" />
                Active Tactical Plan
              </div>
              <div
                style={{
                  fontSize: "0.82rem",
                  lineHeight: 1.5,
                  color: "var(--text-primary)",
                  background: "var(--bg-panel)",
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--border-subtle)",
                }}
              >
                {state.active_plan || (
                  <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                    Waiting for the other speaker to move or reply.
                  </span>
                )}
              </div>
            </div>

            {/* Layer 4: Dyadic Relational Matrix & Trust Notes */}
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div
                className="sidebar-label"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 8,
                }}
              >
                <Users size={13} color="var(--accent-violet)" />
                Layer 4 · Dyadic Relational Bonds (
                {care
                  ? Object.keys(care.relations || {}).length
                  : relationships.length}
                )
              </div>

              {care && Object.keys(care.relations || {}).length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {Object.entries(care.relations).map(([target, edge]) => {
                    const displayTarget =
                      target === "user"
                        ? "Player (You)"
                        : characterNameMap[target] || target;
                    const renderMiniAxis = (label: string, val: number) => {
                      const pct = Math.round(((val + 1) / 2) * 100);
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.69rem" }}>
                            <span style={{ color: "var(--text-muted)" }}>{label}</span>
                            <span>{val >= 0 ? `+${val.toFixed(2)}` : val.toFixed(2)}</span>
                          </div>
                          <div className="meter-track" style={{ height: 4 }}>
                            <div
                              className="meter-fill"
                              style={{
                                width: `${pct}%`,
                                background:
                                  val >= 0.05
                                    ? "var(--accent-emerald)"
                                    : val <= -0.05
                                    ? "var(--accent-rose)"
                                    : "var(--text-muted)",
                              }}
                            />
                          </div>
                        </div>
                      );
                    };
                    return (
                      <div
                        key={target}
                        style={{
                          background: "var(--bg-panel)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: 6,
                          padding: "9px 11px",
                          fontSize: "0.78rem",
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                          <strong style={{ color: "#c4b5fd" }}>{displayTarget}</strong>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {edge.grievance >= 0.15 && (
                              <span
                                className="badge"
                                style={{
                                  fontSize: "0.66rem",
                                  padding: "1px 6px",
                                  borderColor: "rgba(244, 63, 94, 0.45)",
                                  color: "#fda4af",
                                }}
                              >
                                Grievance: {Math.round(edge.grievance * 100)}%
                              </span>
                            )}
                            {Math.abs(edge.obligation) >= 0.15 && (
                              <span
                                className="badge"
                                style={{
                                  fontSize: "0.66rem",
                                  padding: "1px 6px",
                                  borderColor: "rgba(245, 158, 11, 0.45)",
                                  color: "var(--accent-amber)",
                                }}
                              >
                                {edge.obligation > 0
                                  ? `Indebted (+${edge.obligation.toFixed(2)})`
                                  : `Owed Debt (${edge.obligation.toFixed(2)})`}
                              </span>
                            )}
                          </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                          {renderMiniAxis("Warmth", edge.warmth)}
                          {renderMiniAxis("Trust", edge.trust)}
                          {renderMiniAxis("Respect", edge.respect)}
                          {renderMiniAxis("Power", edge.power)}
                        </div>
                        {(edge.episodic_note || state.relationship_notes?.[target]) && (
                          <div style={{ color: "var(--text-secondary)", fontSize: "0.76rem" }}>
                            {edge.episodic_note || state.relationship_notes?.[target]}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : relationships.length === 0 ? (
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  No specific relationship or trust notes recorded yet.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {relationships.map(([target, note]) => {
                    const displayTarget =
                      target === "user"
                        ? "Player"
                        : characterNameMap[target] || target;
                    return (
                      <div
                        key={target}
                        style={{
                          background: "var(--bg-panel)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: 6,
                          padding: "8px 10px",
                          fontSize: "0.78rem",
                        }}
                      >
                        <strong style={{ color: "#c4b5fd" }}>
                          {displayTarget}:
                        </strong>{" "}
                        <span>{note}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Core Drive & Fear Reminder */}
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: 12,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <div>
                <div className="sidebar-label" style={{ marginBottom: 4 }}>
                  Core Drive
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                  {character.baseline_psyche.core_drive}
                </div>
              </div>
              <div>
                <div className="sidebar-label" style={{ marginBottom: 4 }}>
                  Core Fear
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
                  {character.baseline_psyche.core_fear}
                </div>
              </div>
            </div>
          </div>
  );
};
