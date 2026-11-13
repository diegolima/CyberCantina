import React, { useState } from "react";
import {
  AlertTriangle,
  Brain,
  Clock,
  Dices,
  Eye,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type {
  CampaignStateBundle,
  CharacterRecord,
  Phase3TurnProgress,
} from "../../types";
import {
  isLiveStreamCognitionSkipped,
  isLiveStreamNarrator,
} from "../../utils/narratorCognition";
import {
  getTierBadgeClass,
  renderFormattedProse,
  renderUserMessageBubble,
  type LiveStreamState,
} from "./chatHelpers";

export interface LiveStreamingTurnCardProps {
  liveStream: LiveStreamState;
  bundle: CampaignStateBundle;
  character: CharacterRecord;
  allCampaignCharacters: CharacterRecord[];
  presentCharacterIds: string[];
  phase3Progress: Phase3TurnProgress | null;
}

export const LiveStreamingTurnCard: React.FC<LiveStreamingTurnCardProps> = ({
  liveStream,
  bundle,
  character,
  allCampaignCharacters,
  presentCharacterIds,
  phase3Progress,
}) => {
  const [selectedLiveCognitionCharId, setSelectedLiveCognitionCharId] = useState<string | null>(null);
  return (
          <div
            className="turn-card"
            style={{ borderColor: "var(--accent-amber)" }}
          >
            {liveStream.userMessage.startsWith("[") && liveStream.userMessage.endsWith("]") ? (
              <div className="user-bubble user-bubble-narrator-cue">
                <Sparkles size={12} color="var(--accent-amber)" />
                <span>{liveStream.userMessage}</span>
              </div>
            ) : (
              renderUserMessageBubble(liveStream.userMessage, allCampaignCharacters, presentCharacterIds)
            )}
            <div className="meta-strip">
              <span className="badge badge-dice">{liveStream.phaseStatus}</span>
              {(() => {
                const charRolls = liveStream.preTurn?.character_rolls;
                if (charRolls && Object.keys(charRolls).length > 0) {
                  return Object.entries(charRolls).map(([cid, r]) => {
                    const charName =
                      r.character_name ||
                      bundle.character_records?.[cid]?.name ||
                      (cid === character.id ? character.name : null);
                    const label = charName && charName !== "Narrator" ? `${charName}: ` : "";
                    return (
                      <span
                        key={cid}
                        className={`badge badge-dice ${getTierBadgeClass(r.outcome_tier)}`}
                        title={r.narrative_directive}
                      >
                        <Dices size={13} />
                        {label}{r.skill_or_approach}: d20({r.d20_raw})
                        {r.modifier >= 0 ? `+${r.modifier}` : r.modifier} ={" "}
                        {r.total} vs DC {r.difficulty_class} [{r.outcome_tier}]
                      </span>
                    );
                  });
                }
                if (liveStream.preTurn?.resolved_roll) {
                  const r = liveStream.preTurn.resolved_roll;
                  return (
                    <span
                      className={`badge badge-dice ${getTierBadgeClass(r.outcome_tier)}`}
                      title={r.narrative_directive}
                    >
                      <Dices size={13} />
                      Rolled {r.total} vs DC {r.difficulty_class} [{r.outcome_tier}]
                    </span>
                  );
                }
                return null;
              })()}
            </div>

            {phase3Progress &&
              phase3Progress.orderedCharacterIds &&
              phase3Progress.orderedCharacterIds.length > 0 && (
                <div
                  className="agent-pills-row"
                  style={{
                    marginTop: 8,
                    marginBottom: 8,
                    padding: "6px 10px",
                    background: "rgba(255, 255, 255, 0.02)",
                    borderRadius: 6,
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.72rem",
                      color: "var(--text-secondary)",
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    <Brain size={12} color="var(--accent-violet)" />
                    Phase 3 Multi-Cognition ({phase3Progress.dispatchMode}):
                  </span>
                  {phase3Progress.orderedCharacterIds.map((cid) => {
                    const item = phase3Progress.agents[cid];
                    if (!item) return null;
                    const isSelected =
                      (selectedLiveCognitionCharId ??
                        phase3Progress.orderedCharacterIds[0]) === cid;
                    const isThinking = item.status === "thinking";
                    const isCompleted = item.status === "completed";
                    const isFailed = item.status === "failed";
                    const isQueued = item.status === "queued";
                    return (
                      <button
                        key={cid}
                        type="button"
                        className={`agent-pill agent-pill--character ${
                          isThinking ? "agent-pill--running" : ""
                        } ${isQueued ? "agent-pill--queued" : ""} ${
                          isSelected ? "cognition-char-tab--active" : ""
                        }`}
                        onClick={() => setSelectedLiveCognitionCharId(cid)}
                        title={`${item.characterName} (${item.role}): ${item.status}`}
                      >
                        {isThinking && (
                          <RefreshCw size={10} className="spin-slow" />
                        )}
                        {isQueued && (
                          <Clock size={10} style={{ opacity: 0.6 }} />
                        )}
                        {isCompleted && <Brain size={10} />}
                        {isFailed && <AlertTriangle size={10} />}
                        <span>{item.characterName}</span>
                        {item.role === "primary_speaker" && (
                          <span
                            style={{
                              opacity: 0.7,
                              fontSize: "0.62rem",
                            }}
                          >
                            (Primary)
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

            {(() => {
              const liveCharIds =
                phase3Progress && phase3Progress.orderedCharacterIds.length > 0
                  ? phase3Progress.orderedCharacterIds
                  : [character.id];
              const liveSelectedId =
                selectedLiveCognitionCharId ??
                (liveCharIds.includes(character.id)
                  ? character.id
                  : liveCharIds[0]);
              const activeLiveAgent = phase3Progress?.agents[liveSelectedId];
              const activeLiveCog =
                activeLiveAgent?.cognition ??
                (liveSelectedId === character.id
                  ? liveStream.cognitionParsed
                  : null);
              const activeLiveName =
                activeLiveAgent?.characterName ??
                (liveSelectedId === character.id
                  ? character.name
                  : "Character");

              const isNarratorCue = isLiveStreamNarrator(liveStream);
              const liveSkipped = isLiveStreamCognitionSkipped(
                liveStream,
                activeLiveCog
              );
              const isAgentThinking = activeLiveAgent?.status === "thinking";

              return (
                <div
                  className={`cognition-box ${
                    liveSkipped ? "cognition-box-skipped" : ""
                  }`}
                >
                  <div className="cognition-header">
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      {isNarratorCue ? (
                        <Eye size={14} color="var(--accent-cyan)" />
                      ) : liveSkipped ? (
                        <AlertTriangle size={14} color="#f59e0b" />
                      ) : (
                        <Brain size={14} />
                      )}
                      {isNarratorCue
                        ? "Objective Scene Observation (Detached & Indifferent)"
                        : liveSkipped
                        ? `${activeLiveName} Inner Cognition (Skipped by Model)`
                        : liveCharIds.length > 1
                        ? `${activeLiveName} Inner Cognition (Recall → Feel → Want → Plan)`
                        : "Streaming <cognition>..."}
                    </span>
                    {liveSkipped && (
                      <span className="cognition-skipped-pill">
                        <AlertTriangle size={11} />
                        Skipped by Model
                      </span>
                    )}
                  </div>

                  {liveCharIds.length > 1 && !isNarratorCue && (
                    <div className="cognition-char-tabs">
                      {liveCharIds.map((cid) => {
                        const isSelected = cid === liveSelectedId;
                        const a = phase3Progress?.agents[cid];
                        const cName = a?.characterName || cid;
                        const isDone = a?.status === "completed";
                        const isThinking = a?.status === "thinking";
                        return (
                          <button
                            key={cid}
                            type="button"
                            className={`cognition-char-tab ${
                              isSelected ? "cognition-char-tab--active" : ""
                            }`}
                            onClick={() => setSelectedLiveCognitionCharId(cid)}
                          >
                            {isThinking && (
                              <RefreshCw size={10} className="spin-slow" />
                            )}
                            {isDone && <Brain size={11} />}
                            <span>{cName}</span>
                            {a?.role === "primary_speaker" && (
                              <span
                                style={{
                                  fontSize: "0.62rem",
                                  opacity: 0.75,
                                }}
                              >
                                (Speaker)
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {activeLiveCog ? (
                    isNarratorCue ? (
                      <div className="cognition-steps">
                        <div className="cog-step">
                          <div className="cog-step-label">Focus Area</div>
                          <div>
                            {activeLiveCog.recall ||
                              bundle.active_location.name}
                          </div>
                        </div>
                        <div className="cog-step">
                          <div className="cog-step-label">Stance</div>
                          <div>
                            Impersonal, neutral, no emotional puppeteering or
                            helpful hints.
                          </div>
                        </div>
                        <div className="cog-step">
                          <div className="cog-step-label">Directorial Plan</div>
                          <div>
                            {activeLiveCog.plan ||
                              "Sensory environmental description"}
                          </div>
                        </div>
                      </div>
                    ) : liveSkipped ? (
                      <div
                        className="cognition-skipped-banner"
                        style={{ marginTop: 8 }}
                      >
                        <div className="cognition-skipped-banner-title">
                          <AlertTriangle size={14} />
                          <span>Introspection Skipped</span>
                        </div>
                        <div className="cognition-skipped-banner-desc">
                          The model bypassed the <code>&lt;cognition&gt;</code>{" "}
                          block and is streaming narrative prose directly. Prior
                          emotional state is preserved for continuity.
                        </div>
                      </div>
                    ) : (
                      <div className="cognition-steps">
                        <div className="cog-step">
                          <div className="cog-step-label">1. Memory Recall</div>
                          <div>
                            {activeLiveCog.recall || "Present in the moment."}
                          </div>
                        </div>
                        <div className="cog-step">
                          <div className="cog-step-label">
                            2. Affect & Feeling
                          </div>
                          <div>
                            {activeLiveCog.feeling || "Calibrating..."}
                          </div>
                        </div>
                        <div className="cog-step">
                          <div className="cog-step-label">3. Immediate Want</div>
                          <div>{activeLiveCog.want}</div>
                        </div>
                        <div className="cog-step">
                          <div className="cog-step-label">4. Tactical Plan</div>
                          <div>{activeLiveCog.plan}</div>
                        </div>
                      </div>
                    )
                  ) : (
                    <pre
                      style={{
                        marginTop: 8,
                        whiteSpace: "pre-wrap",
                        fontSize: "0.75rem",
                        color: "#c4b5fd",
                      }}
                    >
                      {isAgentThinking
                        ? `${activeLiveName} is evaluating memories & intentions...`
                        : liveStream.cognitionRaw ||
                          (isNarratorCue
                            ? "Observing environment & world state..."
                            : "Analyzing scene & recalling memories...")}
                    </pre>
                  )}
                </div>
              );
            })()}

            {liveStream.proseText && (
              <div className="prose-body">
                {renderFormattedProse(liveStream.proseText)}
              </div>
            )}
          </div>
  );
};
