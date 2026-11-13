import React, { useState } from "react";
import {
  AlertTriangle,
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  Clock,
  Compass,
  Dices,
  Edit3,
  Eye,
  GitBranch,
  Globe,
  ListChecks,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import type {
  CampaignStateBundle,
  CharacterRecord,
  DiceRollResult,
  Phase4TurnProgress,
  TurnNodeRecord,
} from "../../types";
import { getCharacterEmotionPortrait } from "../../utils/entityImages";
import { isNarratorTurnNode, isTurnCognitionSkipped } from "../../utils/narratorCognition";
import type { ActiveAgentModalTarget } from "../inspector/AgentChangesModal";
import {
  getTierBadgeClass,
  renderFormattedProse,
  renderUserMessageBubble,
} from "./chatHelpers";

export interface TurnCardProps {
  turn: TurnNodeRecord;
  turnIdx: number;
  bundle: CampaignStateBundle;
  character: CharacterRecord;
  allCampaignCharacters: CharacterRecord[];
  presentCharacterIds: string[];
  siblings: TurnNodeRecord[];
  isBusy: boolean;
  isDeletingTurn: boolean;
  isEditingThisTurn: boolean;
  hasActiveEditingTurn: boolean;
  hasDeleteLastHandler: boolean;
  cogOpen: boolean;
  memOpen: boolean;
  phase4ProgressByTurn: Record<string, Phase4TurnProgress>;
  onToggleCognition: (turnId: string) => void;
  onToggleMemories: (turnId: string) => void;
  onCheckoutTurn: (turnId: string) => void;
  onStartEdit: (turn: TurnNodeRecord) => void;
  onCancelEdit: () => void;
  onSwipeRegenerate: (turn: TurnNodeRecord) => void;
  onDeleteLast: () => void;
  onOpenAgentModal: (target: ActiveAgentModalTarget) => void;
}

export const TurnCard: React.FC<TurnCardProps> = ({
  turn,
  turnIdx,
  bundle,
  character,
  allCampaignCharacters,
  presentCharacterIds,
  siblings,
  isBusy,
  isDeletingTurn,
  isEditingThisTurn,
  hasActiveEditingTurn,
  hasDeleteLastHandler,
  cogOpen,
  memOpen,
  phase4ProgressByTurn,
  onToggleCognition,
  onToggleMemories,
  onCheckoutTurn,
  onStartEdit,
  onCancelEdit,
  onSwipeRegenerate,
  onDeleteLast,
  onOpenAgentModal,
}) => {
  const [selectedCognitionCharIdByTurn, setSelectedCognitionCharIdByTurn] = useState<Record<string, string>>({});
  const [showRetainedIds, setShowRetainedIds] = useState<Record<string, boolean>>({});
  const toggleRetained = (id: string) =>
    setShowRetainedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  const isRoot = turn.depth_index === 0;
  const isLastTurn = !isRoot && turnIdx === bundle.active_branch_turns.length - 1;
  const isNarratorTurn = turn.actor_id === "__narrator__";
  const isCueMessage = turn.user_message.startsWith("[") && turn.user_message.endsWith("]");
  const toggleCognition = onToggleCognition;
  const toggleMemories = onToggleMemories;
  const handleStartEdit = onStartEdit;
  const handleCancelEdit = onCancelEdit;
  const editingTurn = hasActiveEditingTurn;
  const onDeleteLastTurn = hasDeleteLastHandler;
  const handleSwipeRegenerate = onSwipeRegenerate;
  const handleDeleteLast = onDeleteLast;
  const setActiveAgentModal = onOpenAgentModal;

  const renderAgentPills = (t: TurnNodeRecord) => {
    const progress = phase4ProgressByTurn[t.id];
    let agentKeys: string[] = [];

    if (progress && progress.orderedAgentKeys && progress.orderedAgentKeys.length > 0) {
      agentKeys = progress.orderedAgentKeys;
    } else if (t.post_turn) {
      agentKeys = ["clerk", ...Object.keys(t.post_turn.character_deltas || {})];
    } else if (progress && Object.keys(progress.agents).length > 0) {
      agentKeys = Object.keys(progress.agents);
    }

    if (agentKeys.length === 0) return null;

    return agentKeys.map((agentKey) => {
      const isClerkPill = agentKey === "clerk";
      const progressItem = progress?.agents[agentKey];
      const status = progressItem?.status ?? (t.post_turn ? "completed" : "queued");

      const label = isClerkPill
        ? "clerk"
        : t.post_turn?.character_names?.[agentKey] ||
          bundle.character_records?.[agentKey]?.name ||
          progressItem?.label ||
          "Agent";

      let mutations = 0;
      if (isClerkPill) {
        const pt = t.post_turn || progressItem?.provisionalWorldDelta;
        if (pt) {
          if ((pt.elapsed_minutes ?? 0) > 0) mutations += 1;
          if (pt.transition_type && pt.transition_type !== "stay") mutations += 1;
          mutations += pt.scene_flags_updated?.length || 0;
          mutations += pt.scene_flags_removed?.length || 0;
          if (pt.notable_event_summary) mutations += 1;
        }
      } else {
        const cd =
          t.post_turn?.character_deltas?.[agentKey] ||
          progressItem?.provisionalCharacterDelta;
        if (cd) {
          if (cd.updated_want) mutations += 1;
          if (cd.valence_delta !== 0) mutations += 1;
          if (cd.arousal_delta !== 0) mutations += 1;
          mutations += Object.keys(cd.stance_updates || {}).length;
          mutations += cd.items_equipped?.length || 0;
          mutations += cd.items_unequipped?.length || 0;
          mutations += cd.items_obtained?.length || 0;
          mutations += cd.items_removed?.length || 0;
          if (cd.location_transition && cd.location_transition !== "stay_here") mutations += 1;
          mutations += cd.new_memories?.length || 0;
        }
      }

      const isNoop = status === "completed" && mutations === 0;
      const canClick =
        status === "completed" ||
        status === "arbitrating" ||
        Boolean(
          progressItem?.provisionalCharacterDelta ||
            progressItem?.provisionalWorldDelta ||
            t.post_turn
        );

      const statusClass = `agent-pill--${status}`;
      const roleClass = isClerkPill ? "agent-pill--clerk" : "agent-pill--character";
      const noopClass = isNoop ? "agent-pill--noop" : "";

      return (
        <button
          key={agentKey}
          type="button"
          className={`agent-pill ${roleClass} ${statusClass} ${noopClass}`}
          disabled={!canClick}
          title={
            status === "queued"
              ? `${label}: Queued for Phase 4 evaluation...`
              : status === "running"
              ? `${label}: Actively evaluating scene mutations...`
              : status === "arbitrating"
              ? `${label}: Contested item dispute arbitration in progress...`
              : `${label}: Click to inspect ${mutations} state change${
                  mutations === 1 ? "" : "s"
                }`
          }
          onClick={() => setActiveAgentModal({ turnId: t.id, agentKey })}
        >
          {status === "running" && <RefreshCw size={10} className="spin-slow" />}
          {status === "arbitrating" && <Sparkles size={10} className="pulse-fast" />}
          {status === "queued" && <Clock size={10} style={{ opacity: 0.6 }} />}
          {(status === "completed" || status === "failed") &&
            (isClerkPill ? <Globe size={10} /> : <Bot size={10} />)}
          <span>{label}</span>
          {status === "completed" && mutations > 0 && (
            <span className="agent-pill-count">{mutations}</span>
          )}
        </button>
      );
    });
  };

  return (
            <div key={turn.id} className={`turn-card ${isNarratorTurn ? "narrator-turn-card" : ""} ${isEditingThisTurn ? "turn-card--editing" : ""}`}>
              {!isRoot && (
                <>
                  {isEditingThisTurn && (
                    <div className="turn-editing-banner-pill">
                      <Edit3 size={11} color="var(--accent-amber)" />
                      <span>Editing in composer...</span>
                    </div>
                  )}
                  {isCueMessage ? (
                    turn.user_message.toLowerCase().includes("advance the story") ||
                    turn.user_message.toLowerCase().includes("wait for") ||
                    turn.user_message.toLowerCase().includes("minutes elapse") ? (
                      <div className="user-bubble user-bubble-narrator-time">
                        <Clock size={12} color="var(--accent-amber)" />
                        <span>{turn.user_message.replace(/^\[|\]$/g, "")}</span>
                      </div>
                    ) : turn.user_message.toLowerCase().includes("complication") ? (
                      <div className="user-bubble user-bubble-narrator-complication">
                        <AlertTriangle size={12} color="var(--accent-rose)" />
                        <span>{turn.user_message.replace(/^\[|\]$/g, "")}</span>
                      </div>
                    ) : (
                      <div className="user-bubble user-bubble-narrator-cue">
                        <Sparkles size={12} color="var(--accent-cyan)" />
                        <span>{turn.user_message}</span>
                      </div>
                    )
                  ) : (
                    renderUserMessageBubble(turn.user_message, allCampaignCharacters, presentCharacterIds, turn.whispers)
                  )}
                </>
              )}

              {/* Staged Director Choices Badge Strip */}
              {!isRoot &&
                turn.pre_turn?.character_choices &&
                Object.keys(turn.pre_turn.character_choices).length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap",
                      margin: "4px 0 2px",
                    }}
                  >
                    {Object.entries(turn.pre_turn.character_choices).map(
                      ([cid, cSet]) => {
                        const cName =
                          turn.cognition_character_names?.[cid] ||
                          bundle.character_records?.[cid]?.name ||
                          (cid === character.id ? character.name : "Character");
                        return (
                          <span
                            key={cid}
                            className="badge"
                            style={{
                              background: "rgba(59, 130, 246, 0.12)",
                              borderColor: "rgba(59, 130, 246, 0.35)",
                              color: "#93c5fd",
                              fontSize: "0.71rem",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                            title={cSet.options
                              .map(
                                (o) =>
                                  `${o.label}${
                                    o.gate && o.gate !== "any"
                                      ? ` (${o.gate})`
                                      : ""
                                  }`
                              )
                              .join(" | ")}
                          >
                            <ListChecks size={11} />
                            Director Choices ({cName}): {cSet.options.length}{" "}
                            option{cSet.options.length === 1 ? "" : "s"}
                          </span>
                        );
                      }
                    )}
                  </div>
                )}

              {/* Phase 1 Auxiliary Pre-Turn & RAG Badges */}
              {!isRoot && (
                <div className="meta-strip">
                  {isNarratorTurn && (
                    <span className="badge badge-narrator">
                      <Eye size={12} color="var(--accent-cyan)" />
                      {turn.user_message.toLowerCase().includes("advance") ||
                      turn.user_message.toLowerCase().includes("wait")
                        ? "Narrator (Time Advance)"
                        : turn.user_message.toLowerCase().includes("complication")
                        ? "Narrator (Complication)"
                        : "Narrator (Objective Lens)"}
                    </span>
                  )}
                  <span className="badge" title={turn.pre_turn.subtext_interpretation}>
                    <Sparkles size={12} color="var(--accent-cyan)" />
                    Tone: {turn.pre_turn.user_sentiment}
                  </span>

                  {turn.pre_turn.spatial_intent !== "stay" && (
                    <span className="badge">
                      <Compass size={12} color="var(--accent-amber)" />
                      Intent: {turn.pre_turn.spatial_intent}
                      {turn.pre_turn.target_location_hint
                        ? ` (${turn.pre_turn.target_location_hint})`
                        : ""}
                    </span>
                  )}

                  {(() => {
                    const charRolls = turn.pre_turn.character_rolls;
                    const rollsToRender: Array<{ id: string; roll: DiceRollResult }> = [];
                    if (charRolls && Object.keys(charRolls).length > 0) {
                      const speakerOrder = turn.pre_turn.speaker_order || [];
                      const orderedIds = [
                        ...speakerOrder.filter((id) => id in charRolls),
                        ...Object.keys(charRolls).filter((id) => !speakerOrder.includes(id)),
                      ];
                      for (const cid of orderedIds) {
                        rollsToRender.push({ id: cid, roll: charRolls[cid] });
                      }
                    } else if (turn.pre_turn.resolved_roll) {
                      rollsToRender.push({
                        id: turn.pre_turn.resolved_roll.character_id || "default",
                        roll: turn.pre_turn.resolved_roll,
                      });
                    }

                    return rollsToRender.map(({ id, roll: r }) => {
                      const charName =
                        r.character_name ||
                        (id !== "default" && turn.cognition_character_names?.[id]) ||
                        (id !== "default" && bundle.character_records?.[id]?.name) ||
                        (id === character.id ? character.name : null);
                      const label = charName && charName !== "Narrator" ? `${charName}: ` : "";
                      return (
                        <span
                          key={id}
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
                  })()}

                  {turn.recalled_items.length > 0 && (
                    <button
                      type="button"
                      className="badge badge-rag"
                      style={{ cursor: "pointer" }}
                      onClick={() => toggleMemories(turn.id)}
                    >
                      RAG Injected: {turn.recalled_items.length} shards
                    </button>
                  )}
                </div>
              )}

              {memOpen && turn.recalled_items.length > 0 && (
                <div
                  style={{
                    background: "rgba(16, 185, 129, 0.07)",
                    border: "1px solid rgba(16, 185, 129, 0.3)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    fontSize: "0.78rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  {turn.recalled_items.map((item) => (
                    <div key={item.id}>
                      <strong style={{ color: "#6ee7b7" }}>
                        [{item.source_type.toUpperCase()}] {item.title}
                      </strong>{" "}
                      <span style={{ color: "var(--text-muted)" }}>
                        (score {item.score.toFixed(2)})
                      </span>
                      : {item.content}
                    </div>
                  ))}
                </div>
              )}

              {/* Phase 3 Multi-Step <cognition> Drawer */}
              {(() => {
                if (turn.depth_index === 0) {
                  return null;
                }
                const isNarratorTurn = isNarratorTurnNode(turn);
                const hasMultiCognition = Boolean(
                  turn.cognitions && Object.keys(turn.cognitions).length > 0
                );
                const charIds = hasMultiCognition
                  ? Object.keys(turn.cognitions!)
                  : [character.id];
                const selectedCharId =
                  selectedCognitionCharIdByTurn[turn.id] ??
                  (charIds.includes(character.id) ? character.id : charIds[0]);
                const activeCognition =
                  (turn.cognitions && turn.cognitions[selectedCharId]) ||
                  turn.cognition;
                const activeCharName =
                  (turn.cognition_character_names &&
                    turn.cognition_character_names[selectedCharId]) ||
                  bundle.character_records?.[selectedCharId]?.name ||
                  (selectedCharId === character.id
                    ? character.name
                    : "Character");

                const isSkipped = isTurnCognitionSkipped(turn, activeCognition);
                const showRetained = Boolean(showRetainedIds[turn.id]);

                return (
                  <div
                    className={`cognition-box ${
                      isSkipped ? "cognition-box-skipped" : ""
                    }`}
                  >
                    <div
                      className="cognition-header"
                      onClick={() => toggleCognition(turn.id)}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {isNarratorTurn ? (
                          <Eye size={14} color="var(--accent-cyan)" />
                        ) : isSkipped ? (
                          <AlertTriangle size={14} color="#f59e0b" />
                        ) : (
                          <Brain size={14} />
                        )}
                        {isNarratorTurn
                          ? "Objective Scene Observation (Detached & Indifferent)"
                          : isSkipped
                          ? `${activeCharName} Inner Cognition (Skipped by Model)`
                          : charIds.length > 1
                          ? `${activeCharName} Inner Cognition (${charIds.length} Characters Evaluated)`
                          : `${activeCharName} Inner Cognition (Recall → Feel → Want → Plan)`}
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        {isSkipped ? (
                          <span className="cognition-skipped-pill">
                            <AlertTriangle size={11} />
                            Skipped by Model
                          </span>
                        ) : (
                          !isNarratorTurn && (
                            <span
                              style={{
                                fontSize: "0.72rem",
                                color: "var(--text-secondary)",
                              }}
                            >
                              {activeCognition.feeling_tone
                                ? `${activeCognition.feeling_tone} · ${activeCognition.feeling_intensity || "moderate"}`
                                : `Valence ${activeCognition.valence >= 0 ? "+" : ""}${activeCognition.valence.toFixed(2)} | Arousal ${activeCognition.arousal.toFixed(2)}`}
                            </span>
                          )
                        )}
                        {cogOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </span>
                    </div>

                    {cogOpen && (
                      <>
                        {charIds.length > 1 && !isNarratorTurn && (
                          <div className="cognition-char-tabs">
                            {charIds.map((cid) => {
                              const isSelected = cid === selectedCharId;
                              const cName =
                                turn.cognition_character_names?.[cid] ||
                                bundle.character_records?.[cid]?.name ||
                                (cid === character.id ? character.name : cid);
                              const cBlock = turn.cognitions?.[cid];
                              const isPrimary = cid === character.id;
                              return (
                                <button
                                  key={cid}
                                  type="button"
                                  className={`cognition-char-tab ${
                                    isSelected ? "cognition-char-tab--active" : ""
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedCognitionCharIdByTurn((prev) => ({
                                      ...prev,
                                      [turn.id]: cid,
                                    }));
                                  }}
                                  title={`View cognition for ${cName}${
                                    isPrimary ? " (Primary Speaker)" : ""
                                  }`}
                                >
                                  <Brain size={11} />
                                  <span>{cName}</span>
                                  {isPrimary && (
                                    <span
                                      style={{
                                        fontSize: "0.62rem",
                                        opacity: 0.75,
                                      }}
                                    >
                                      (Speaker)
                                    </span>
                                  )}
                                  {cBlock && (
                                    <span
                                      style={{
                                        fontSize: "0.65rem",
                                        opacity: 0.65,
                                        marginLeft: 2,
                                      }}
                                    >
                                      [{cBlock.valence >= 0 ? "+" : ""}
                                      {cBlock.valence.toFixed(1)},{" "}
                                      {cBlock.arousal.toFixed(1)}]
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {(() => {
                          const charRoll =
                            turn.pre_turn?.character_rolls?.[selectedCharId] ??
                            (selectedCharId === character.id ? turn.pre_turn?.resolved_roll : undefined);
                          if (!charRoll) return null;
                          return (
                            <div
                              className={`cognition-roll-banner ${getTierBadgeClass(charRoll.outcome_tier)}`}
                              style={{
                                margin: "6px 12px 10px",
                                padding: "8px 12px",
                                borderRadius: 6,
                                border: "1px solid",
                                fontSize: "0.75rem",
                                display: "flex",
                                flexDirection: "column",
                                gap: 4,
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  gap: 8,
                                }}
                              >
                                <span
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    fontWeight: 600,
                                  }}
                                >
                                  <Dices size={13} />
                                  {charRoll.skill_or_approach}: {charRoll.outcome_tier}
                                </span>
                                <span style={{ opacity: 0.85, fontSize: "0.72rem" }}>
                                  Rolled {charRoll.total} (d20: {charRoll.d20_raw}
                                  {charRoll.modifier >= 0 ? `+${charRoll.modifier}` : charRoll.modifier}) vs DC{" "}
                                  {charRoll.difficulty_class}
                                </span>
                              </div>
                              {charRoll.plan_directive && (
                                <div style={{ fontSize: "0.72rem", opacity: 0.9 }}>
                                  <strong>Plan Directive:</strong> {charRoll.plan_directive}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {(() => {
                          const choiceRes =
                            turn.pre_turn?.choice_resolutions?.[selectedCharId];
                          const choiceSet =
                            turn.pre_turn?.character_choices?.[selectedCharId];
                          const selectedChoice = activeCognition.selected_choice;
                          const compliance = activeCognition.choice_compliance;
                          const complianceNote =
                            activeCognition.choice_compliance_note;

                          if (!choiceRes && !choiceSet && !selectedChoice)
                            return null;

                          return (
                            <div
                              style={{
                                margin: "6px 12px 10px",
                                padding: "8px 12px",
                                borderRadius: 6,
                                border: "1px solid rgba(59, 130, 246, 0.35)",
                                background: "rgba(59, 130, 246, 0.08)",
                                fontSize: "0.75rem",
                                display: "flex",
                                flexDirection: "column",
                                gap: 6,
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  gap: 8,
                                  flexWrap: "wrap",
                                }}
                              >
                                <span
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    fontWeight: 600,
                                    color: "#93c5fd",
                                  }}
                                >
                                  <ListChecks size={13} />
                                  Director Choices Guidance
                                </span>
                                {compliance && (
                                  <span
                                    className={`choice-compliance-badge ${
                                      compliance === "followed"
                                        ? "choice-compliance-followed"
                                        : compliance === "coerced"
                                        ? "choice-compliance-coerced"
                                        : "choice-compliance-fallback"
                                    }`}
                                    title={complianceNote || undefined}
                                  >
                                    {compliance === "followed" &&
                                      "✓ Choice Adopted"}
                                    {compliance === "coerced" &&
                                      "⚡ Directorial Intervention"}
                                    {compliance === "free_fallback" &&
                                      "○ Gated Out — Decided Freely"}
                                  </span>
                                )}
                              </div>

                              {selectedChoice && (
                                <div
                                  style={{
                                    fontSize: "0.74rem",
                                    color: "var(--text-primary)",
                                  }}
                                >
                                  <strong style={{ color: "#93c5fd" }}>
                                    Selected Option:
                                  </strong>{" "}
                                  “{selectedChoice}”
                                </div>
                              )}

                              {complianceNote && compliance === "coerced" && (
                                <div
                                  style={{
                                    fontSize: "0.70rem",
                                    color: "#fde047",
                                    opacity: 0.9,
                                    fontStyle: "italic",
                                  }}
                                >
                                  Notice: {complianceNote}
                                </div>
                              )}

                              {choiceRes &&
                                choiceRes.options_evaluated &&
                                choiceRes.options_evaluated.length > 0 && (
                                  <div
                                    style={{
                                      display: "flex",
                                      gap: 4,
                                      flexWrap: "wrap",
                                      marginTop: 2,
                                    }}
                                  >
                                    {choiceRes.options_evaluated.map((opt) => {
                                      const isChosen =
                                        opt.label === selectedChoice;
                                      const isEliminated =
                                        opt.status === "eliminated";
                                      return (
                                        <span
                                          key={opt.id}
                                          style={{
                                            fontSize: "0.69rem",
                                            padding: "2px 6px",
                                            borderRadius: 4,
                                            border: "1px solid",
                                            textDecoration: isEliminated
                                              ? "line-through"
                                              : "none",
                                            opacity: isEliminated ? 0.5 : 1,
                                            background: isChosen
                                              ? "rgba(34, 197, 94, 0.2)"
                                              : isEliminated
                                              ? "rgba(239, 68, 68, 0.1)"
                                              : "rgba(255, 255, 255, 0.05)",
                                            borderColor: isChosen
                                              ? "rgba(34, 197, 94, 0.5)"
                                              : isEliminated
                                              ? "rgba(239, 68, 68, 0.3)"
                                              : "var(--border-subtle)",
                                            color: isChosen
                                              ? "#86efac"
                                              : isEliminated
                                              ? "var(--text-muted)"
                                              : "var(--text-secondary)",
                                          }}
                                        >
                                          {isChosen
                                            ? "✓ "
                                            : isEliminated
                                            ? "✕ "
                                            : ""}
                                          {opt.label}
                                          {opt.gate && opt.gate !== "any"
                                            ? ` [${opt.gate}]`
                                            : ""}
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}
                            </div>
                          );
                        })()}

                        {isNarratorTurn ? (
                          <div className="cognition-steps">
                            <div className="cog-step">
                              <div className="cog-step-label">Focus Area</div>
                              <div>
                                {activeCognition.recall || bundle.active_location.name}
                              </div>
                            </div>
                            <div className="cog-step">
                              <div className="cog-step-label">Stance</div>
                              <div>
                                Impersonal, neutral, zero emotional puppeteering or
                                helpful hints.
                              </div>
                            </div>
                            <div className="cog-step">
                              <div className="cog-step-label">Directorial Plan</div>
                              <div>
                                {activeCognition.plan ||
                                  "Sensory environmental description"}
                              </div>
                            </div>
                          </div>
                        ) : isSkipped ? (
                          <div className="cognition-skipped-content">
                            <div className="cognition-skipped-banner">
                              <div className="cognition-skipped-banner-title">
                                <AlertTriangle size={15} />
                                <span>Cognitive Introspection Skipped</span>
                              </div>
                              <div className="cognition-skipped-banner-desc">
                                The model bypassed the <code>&lt;cognition&gt;</code> block
                                and generated narrative prose directly. Emotional stance
                                and tactical intentions were retained from prior context to
                                maintain continuity, but no new inner thoughts were
                                generated for this turn.
                              </div>
                              <button
                                type="button"
                                className="cognition-retained-toggle"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleRetained(turn.id);
                                }}
                              >
                                {showRetained
                                  ? "Hide retained state values"
                                  : "Inspect retained state values"}
                              </button>
                            </div>

                            {showRetained && (
                              <div className="cognition-steps cognition-steps-retained">
                                <div className="cog-step cog-step-muted">
                                  <div className="cog-step-label">
                                    1. Memory Recall (Retained)
                                  </div>
                                  <div>
                                    {activeCognition.recall || "None (Omitted)"}
                                  </div>
                                </div>
                                <div className="cog-step cog-step-muted">
                                  <div className="cog-step-label">
                                    2. Affect & Feeling (Retained)
                                  </div>
                                  <div>
                                    {activeCognition.feeling || "Unchanged"}
                                    <div
                                      style={{
                                        fontSize: "0.7rem",
                                        marginTop: 4,
                                        color: "var(--text-secondary)",
                                      }}
                                    >
                                      Valence:{" "}
                                      {activeCognition.valence >= 0 ? "+" : ""}
                                      {activeCognition.valence.toFixed(2)} | Arousal:{" "}
                                      {activeCognition.arousal.toFixed(2)}
                                    </div>
                                  </div>
                                </div>
                                <div className="cog-step cog-step-muted">
                                  <div className="cog-step-label">
                                    3. Immediate Want (Retained)
                                  </div>
                                  <div>{activeCognition.want || "Unchanged"}</div>
                                </div>
                                <div className="cog-step cog-step-muted">
                                  <div className="cog-step-label">
                                    4. Tactical Plan (Retained)
                                  </div>
                                  <div>{activeCognition.plan || "Unchanged"}</div>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="cognition-steps">
                            <div className="cog-step">
                              <div className="cog-step-label">1. Memory Recall</div>
                              <div>
                                {activeCognition.recall || "Present in the moment."}
                              </div>
                            </div>
                            <div className="cog-step">
                              <div className="cog-step-label">2. Affect & Feeling</div>
                              <div>{activeCognition.feeling}</div>
                            </div>
                            <div className="cog-step">
                              <div className="cog-step-label">3. Immediate Want</div>
                              <div>{activeCognition.want}</div>
                            </div>
                            <div className="cog-step">
                              <div className="cog-step-label">4. Tactical Plan</div>
                              <div>{activeCognition.plan}</div>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })()}

              {/* Speaker Emotion Portrait Header (when available) & Narrative Prose */}
              {!isNarratorTurn &&
                (() => {
                  const actorId = turn.actor_id || character.id;
                  const speakerChar =
                    bundle.character_records?.[actorId] ||
                    (actorId === character.id ? character : null);
                  const speakerState =
                    turn.character_states?.[actorId] ||
                    (turn.character_state?.character_id === actorId
                      ? turn.character_state
                      : null);
                  const activeEmotion =
                    speakerState?.care_state?.active_emotion ?? "default";
                  const speakerPortrait = getCharacterEmotionPortrait(
                    speakerChar,
                    activeEmotion
                  );
                  if (!speakerPortrait) return null;
                  return (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        marginBottom: 8,
                      }}
                    >
                      <img
                        src={speakerPortrait}
                        alt={`${speakerChar?.name || "Speaker"} (${activeEmotion})`}
                        title={`Expression: ${activeEmotion}`}
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: "50%",
                          objectFit: "cover",
                          border: "1px solid var(--border-subtle)",
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontWeight: 600, fontSize: "0.82rem" }}>
                            {speakerChar?.name}
                          </span>
                          {activeEmotion !== "default" && (
                            <span
                              className="badge"
                              style={{
                                fontSize: "0.64rem",
                                padding: "0px 6px",
                                textTransform: "capitalize",
                              }}
                            >
                              {activeEmotion}
                            </span>
                          )}
                        </div>
                        {(speakerState?.care_state?.outward_demeanor ||
                          speakerState?.mood_label) && (
                          <span
                            style={{
                              fontSize: "0.72rem",
                              color: "var(--text-muted)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {speakerState?.care_state?.outward_demeanor ||
                              speakerState?.mood_label}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}
              <div className="prose-body">{renderFormattedProse(turn.raw_prose)}</div>

              {/* Turn Footer: Clock, Post-Turn Delta, Phase 4 Agent Mutation Pills, Swipe/Regenerate */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  borderTop: "1px solid var(--border-subtle)",
                  paddingTop: 8,
                  fontSize: "0.74rem",
                  color: "var(--text-muted)",
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
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span>Turn #{turn.depth_index}</span>
                    <span>• {turn.world_snapshot.world_timestamp}</span>
                    {turn.post_turn?.notable_event_summary && (
                      <span style={{ color: "var(--accent-amber)" }}>
                        ★ {turn.post_turn.notable_event_summary}
                      </span>
                    )}

                    {/* Phase 4 Clerk & Character Agent Badges ("Pills") */}
                    {!isRoot && (
                      <div className="agent-pills-row">
                        {renderAgentPills(turn)}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {siblings.length > 1 && (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <GitBranch size={12} color="var(--accent-cyan)" />
                        {siblings.map((sib, idx) => (
                          <button
                            key={sib.id}
                            type="button"
                            className="btn"
                            style={{
                              padding: "2px 7px",
                              fontSize: "0.7rem",
                              borderColor:
                                sib.id === turn.id
                                  ? "var(--accent-amber)"
                                  : "var(--border-subtle)",
                            }}
                            title={`Swipe v${idx + 1}: ${sib.user_message}`}
                            disabled={isBusy}
                            onClick={() => {
                              if (editingTurn) handleCancelEdit();
                              onCheckoutTurn(sib.id);
                            }}
                          >
                            v{idx + 1}
                          </button>
                        ))}
                      </div>
                    )}

                    {isLastTurn && (
                      <button
                        type="button"
                        className={`btn ${isEditingThisTurn ? "btn-amber" : ""}`}
                        style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                        disabled={isBusy || isDeletingTurn}
                        onClick={() => {
                          if (isEditingThisTurn) {
                            handleCancelEdit();
                          } else {
                            handleStartEdit(turn);
                          }
                        }}
                        title={
                          isEditingThisTurn
                            ? "Cancel editing this turn"
                            : "Edit last message in composer and generate a new swipe"
                        }
                      >
                        <Edit3 size={12} />
                        {isEditingThisTurn ? "Editing..." : "Edit"}
                      </button>
                    )}

                    {!isRoot && (
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                        disabled={isBusy || isDeletingTurn}
                        onClick={() => handleSwipeRegenerate(turn)}
                        title="Swipe / Regenerate this turn from its parent state snapshot"
                      >
                        <RefreshCw size={12} />
                        Swipe
                      </button>
                    )}

                    {isLastTurn && onDeleteLastTurn && (
                      <button
                        type="button"
                        className="btn btn-danger"
                        style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                        disabled={isBusy || isDeletingTurn}
                        onClick={handleDeleteLast}
                        title="Delete last message and all generated swipes"
                      >
                        <Trash2 size={12} />
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
  );
};
