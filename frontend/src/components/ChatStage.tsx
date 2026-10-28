import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Brain,
  ChevronDown,
  ChevronRight,
  Clock,
  Compass,
  Dices,
  Edit3,
  Eye,
  GitBranch,
  MapPin,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  CampaignStateBundle,
  CharacterRecord,
  CognitionBlock,
  NarrativeMode,
  PreTurnAnalysis,
  RecalledMemoryItem,
  TurnNodeRecord,
} from "../types";

interface LiveStreamState {
  userMessage: string;
  preTurn: PreTurnAnalysis | null;
  recalledItems: RecalledMemoryItem[];
  cognitionRaw: string;
  cognitionParsed: CognitionBlock | null;
  proseText: string;
  phaseStatus: string;
}

interface ChatStageProps {
  bundle: CampaignStateBundle;
  character: CharacterRecord;
  isStreaming: boolean;
  liveStream: LiveStreamState | null;
  streamError?: string | null;
  onOpenSettings?: () => void;
  onSendTurn: (opts: {
    userMessage: string;
    parentTurnId?: string | null;
    manualDiceOverride?: number | null;
    narrativeMode?: NarrativeMode;
    narratorDirective?: string | null;
    durationMinutes?: number | null;
  }) => void;
  onCheckoutTurn: (turnId: string) => void;
  onDeleteLastTurn?: () => Promise<void> | void;
}

function renderFormattedProse(text: string): React.ReactNode {
  const parts = text.split(/(\*[^*]+\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={idx}>{part.slice(1, -1)}</em>;
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export const ChatStage: React.FC<ChatStageProps> = ({
  bundle,
  character,
  isStreaming,
  liveStream,
  streamError,
  onOpenSettings,
  onSendTurn,
  onCheckoutTurn,
  onDeleteLastTurn,
}) => {
  const [inputText, setInputText] = useState("");
  const [diceOverride, setDiceOverride] = useState<string>("");
  const [openCognitionIds, setOpenCognitionIds] = useState<Record<string, boolean>>({});
  const [openMemoryIds, setOpenMemoryIds] = useState<Record<string, boolean>>({});
  const [editingTurnId, setEditingTurnId] = useState<string | null>(null);
  const [editMessageText, setEditMessageText] = useState("");
  const [isDeletingTurn, setIsDeletingTurn] = useState(false);
  const [isDurationPickerOpen, setIsDurationPickerOpen] = useState(false);
  const [isCustomDirectiveOpen, setIsCustomDirectiveOpen] = useState(false);
  const [customDirectiveText, setCustomDirectiveText] = useState("");

  const lastBranchTurn =
    bundle.active_branch_turns[bundle.active_branch_turns.length - 1];

  useEffect(() => {
    setEditingTurnId(null);
    setEditMessageText("");
    setIsDurationPickerOpen(false);
    setIsCustomDirectiveOpen(false);
  }, [bundle.campaign.id, lastBranchTurn?.id]);

  const toggleCognition = (id: string) => {
    setOpenCognitionIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleMemories = (id: string) => {
    setOpenMemoryIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleInvokeNarrator = (
    mode: NarrativeMode,
    directive?: string,
    durationMinutes?: number
  ) => {
    setIsDurationPickerOpen(false);
    setIsCustomDirectiveOpen(false);

    if (mode === "custom") {
      setIsCustomDirectiveOpen(true);
      return;
    }

    if (mode === "describe") {
      onSendTurn({
        userMessage: "[Describe the current scene]",
        narrativeMode: "describe",
      });
    } else if (mode === "advance") {
      const durMsg = durationMinutes
        ? `wait for ${durationMinutes} minutes`
        : directive || "wait for a few moments";
      onSendTurn({
        userMessage: `[Advance the story: ${durMsg}]`,
        narrativeMode: "advance",
        narratorDirective: durMsg,
        durationMinutes: durationMinutes ?? null,
      });
    } else if (mode === "complication") {
      onSendTurn({
        userMessage: directive
          ? `[Introduce a complication: ${directive}]`
          : "[Introduce an unexpected complication or external event]",
        narrativeMode: "complication",
        narratorDirective: directive || "An unexpected complication occurs",
      });
    } else if (mode === "perception") {
      onSendTurn({
        userMessage: directive
          ? `[Perception check: ${directive}]`
          : "[Examine the scene for subtle details and lore]",
        narrativeMode: "perception",
        narratorDirective: directive || "Check for subtle details and lore",
      });
    }
  };

  const handleSendCustomDirective = () => {
    const trimmed = customDirectiveText.trim();
    if (!trimmed || isStreaming) return;
    onSendTurn({
      userMessage: trimmed,
      narrativeMode: "custom",
      narratorDirective: trimmed,
    });
    setCustomDirectiveText("");
    setIsCustomDirectiveOpen(false);
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = inputText.trim();
    if (!raw || isStreaming) return;

    // Check for slash command shortcuts
    if (raw.startsWith("/")) {
      const parts = raw.slice(1).split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const arg = parts.slice(1).join(" ").trim();

      if (cmd === "look" || cmd === "scene" || cmd === "describe") {
        setInputText("");
        handleInvokeNarrator("describe");
        return;
      }
      if (cmd === "wait" || cmd === "pass") {
        setInputText("");
        let dur: number | undefined;
        if (arg.endsWith("m") || arg.endsWith("min") || arg.endsWith("minutes")) {
          dur = parseInt(arg, 10);
        } else if (arg.endsWith("h") || arg.endsWith("hr") || arg.endsWith("hours")) {
          dur = parseInt(arg, 10) * 60;
        }
        handleInvokeNarrator("advance", arg || "a few moments", isNaN(dur as number) ? undefined : dur);
        return;
      }
      if (cmd === "event" || cmd === "complication") {
        setInputText("");
        handleInvokeNarrator("complication", arg || undefined);
        return;
      }
      if (cmd === "perception" || cmd === "recall" || cmd === "check") {
        setInputText("");
        handleInvokeNarrator("perception", arg || undefined);
        return;
      }
      if (cmd === "narrate" || cmd === "direct" || cmd === "custom") {
        setInputText("");
        if (arg) {
          onSendTurn({
            userMessage: arg,
            narrativeMode: "custom",
            narratorDirective: arg,
          });
        } else {
          setIsCustomDirectiveOpen(true);
        }
        return;
      }
    }

    const parsedDice = diceOverride ? parseInt(diceOverride, 10) : null;
    onSendTurn({
      userMessage: raw,
      manualDiceOverride:
        parsedDice && parsedDice >= 1 && parsedDice <= 20 ? parsedDice : null,
    });
    setInputText("");
    setDiceOverride("");
  };

  const inferNarratorTurnOptions = (
    turn: TurnNodeRecord,
    customMessage?: string
  ): {
    isNarrator: boolean;
    narrativeMode?: NarrativeMode;
    narratorDirective?: string;
    durationMinutes?: number;
  } => {
    if (turn.actor_id !== "__narrator__") {
      return { isNarrator: false };
    }

    const msg = (customMessage ?? turn.user_message).trim();
    const lower = msg.toLowerCase();

    if (lower.includes("describe the current scene")) {
      return { isNarrator: true, narrativeMode: "describe" };
    }

    if (
      lower.includes("advance the story") ||
      lower.includes("wait for") ||
      lower.includes("minutes elapse")
    ) {
      const minMatch = msg.match(/(\d+)\s*minutes?/i);
      const durationMinutes = minMatch ? parseInt(minMatch[1], 10) : undefined;
      const directiveMatch = msg.match(/^\[Advance the story:\s*(.*?)\]$/i);
      const directive = directiveMatch ? directiveMatch[1].trim() : undefined;
      return {
        isNarrator: true,
        narrativeMode: "advance",
        durationMinutes,
        narratorDirective: directive,
      };
    }

    if (lower.includes("complication")) {
      const dirMatch = msg.match(/^\[Introduce a complication:\s*(.*?)\]$/i);
      const directive = dirMatch ? dirMatch[1].trim() : undefined;
      return {
        isNarrator: true,
        narrativeMode: "complication",
        narratorDirective: directive,
      };
    }

    if (lower.includes("perception") || lower.includes("examine the scene")) {
      const dirMatch = msg.match(/^\[Perception check:\s*(.*?)\]$/i);
      const directive = dirMatch ? dirMatch[1].trim() : undefined;
      return {
        isNarrator: true,
        narrativeMode: "perception",
        narratorDirective: directive,
      };
    }

    // Custom directive
    return {
      isNarrator: true,
      narrativeMode: "custom",
      narratorDirective: msg.replace(/^\[|\]$/g, ""),
    };
  };

  const handleSwipeRegenerate = (turn: TurnNodeRecord) => {
    if (isStreaming || isDeletingTurn || !turn.parent_turn_id) return;
    const narratorOpts = inferNarratorTurnOptions(turn);
    if (narratorOpts.isNarrator) {
      onSendTurn({
        userMessage: turn.user_message,
        parentTurnId: turn.parent_turn_id,
        narrativeMode: narratorOpts.narrativeMode,
        narratorDirective: narratorOpts.narratorDirective,
        durationMinutes: narratorOpts.durationMinutes,
      });
      return;
    }

    onSendTurn({
      userMessage: turn.user_message,
      parentTurnId: turn.parent_turn_id,
    });
  };

  const handleStartEdit = (turn: TurnNodeRecord) => {
    if (isStreaming || isDeletingTurn || !turn.parent_turn_id) return;
    setEditingTurnId(turn.id);
    setEditMessageText(turn.user_message);
  };

  const handleCancelEdit = () => {
    setEditingTurnId(null);
    setEditMessageText("");
  };

  const handleCommitEdit = (turn: TurnNodeRecord) => {
    const trimmed = editMessageText.trim();
    if (!trimmed || isStreaming || isDeletingTurn || !turn.parent_turn_id) return;
    const parsedDice = diceOverride ? parseInt(diceOverride, 10) : null;
    setEditingTurnId(null);
    setEditMessageText("");

    const narratorOpts = inferNarratorTurnOptions(turn, trimmed);
    if (narratorOpts.isNarrator) {
      onSendTurn({
        userMessage: trimmed,
        parentTurnId: turn.parent_turn_id,
        narrativeMode: narratorOpts.narrativeMode,
        narratorDirective: narratorOpts.narratorDirective || trimmed,
        durationMinutes: narratorOpts.durationMinutes,
      });
      return;
    }

    onSendTurn({
      userMessage: trimmed,
      parentTurnId: turn.parent_turn_id,
      manualDiceOverride:
        parsedDice && parsedDice >= 1 && parsedDice <= 20 ? parsedDice : null,
    });
  };

  const handleDeleteLast = async () => {
    if (isStreaming || isDeletingTurn || !onDeleteLastTurn) return;
    setIsDeletingTurn(true);
    try {
      setEditingTurnId(null);
      await onDeleteLastTurn();
    } finally {
      setIsDeletingTurn(false);
    }
  };

  // Count sibling branches per parent_turn_id so user can see alternate swipes
  const siblingsByParent: Record<string, TurnNodeRecord[]> = {};
  for (const node of bundle.all_turn_nodes) {
    const key = node.parent_turn_id ?? "ROOT";
    if (!siblingsByParent[key]) siblingsByParent[key] = [];
    siblingsByParent[key].push(node);
  }

  return (
    <main className="chat-stage">
      <header className="stage-header">
        <div>
          <div style={{ fontWeight: 700, fontSize: "1.02rem" }}>
            {bundle.campaign.name}
          </div>
          <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)" }}>
            Actor: <strong style={{ color: "var(--accent-amber)" }}>{character.name}</strong>{" "}
            — {character.tagline}
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span className="badge">
            <MapPin size={13} color="var(--accent-cyan)" />
            {bundle.active_location.name}
          </span>
          <span className="badge">
            <Clock size={13} color="var(--accent-amber)" />
            {bundle.current_world_snapshot.world_timestamp}
          </span>
        </div>
      </header>

      <div className="turn-feed">
        {bundle.active_branch_turns.map((turn, turnIdx) => {
          const isRoot = turn.depth_index === 0;
          const isLastTurn =
            !isRoot && turnIdx === bundle.active_branch_turns.length - 1;
          const isEditingThisTurn = isLastTurn && editingTurnId === turn.id;
          const isNarratorTurn = turn.actor_id === "__narrator__";
          const isCueMessage = turn.user_message.startsWith("[") && turn.user_message.endsWith("]");
          const cogOpen = openCognitionIds[turn.id] ?? (turn.depth_index === bundle.active_branch_turns.length - 1);
          const memOpen = openMemoryIds[turn.id] ?? false;
          const siblings = siblingsByParent[turn.parent_turn_id ?? "ROOT"] || [];
          const roll = turn.pre_turn.resolved_roll;

          return (
            <div key={turn.id} className={`turn-card ${isNarratorTurn ? "narrator-turn-card" : ""}`}>
              {!isRoot &&
                (isEditingThisTurn ? (
                  <div className="user-bubble user-bubble-editing">
                    <div className="user-bubble-edit-header">
                      <Edit3 size={12} color="var(--accent-amber)" />
                      <span>Edit message (generates a new swipe)</span>
                    </div>
                    <textarea
                      className="field-textarea user-bubble-edit-textarea"
                      value={editMessageText}
                      onChange={(e) => setEditMessageText(e.target.value)}
                      rows={3}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleCommitEdit(turn);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          handleCancelEdit();
                        }
                      }}
                    />
                    <div className="user-bubble-edit-actions">
                      <button
                        type="button"
                        className="btn"
                        style={{ padding: "3px 10px", fontSize: "0.74rem" }}
                        onClick={handleCancelEdit}
                      >
                        <X size={12} />
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-amber"
                        style={{ padding: "3px 10px", fontSize: "0.74rem" }}
                        disabled={isStreaming || !editMessageText.trim()}
                        onClick={() => handleCommitEdit(turn)}
                      >
                        <RefreshCw size={12} />
                        Save & Swipe
                      </button>
                    </div>
                  </div>
                ) : isCueMessage ? (
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
                  ) : turn.user_message.toLowerCase().includes("perception") ||
                    turn.user_message.toLowerCase().includes("examine") ? (
                    <div className="user-bubble user-bubble-narrator-perception">
                      <Brain size={12} color="var(--accent-violet)" />
                      <span>{turn.user_message.replace(/^\[|\]$/g, "")}</span>
                    </div>
                  ) : (
                    <div className="user-bubble user-bubble-narrator-cue">
                      <Sparkles size={12} color="var(--accent-cyan)" />
                      <span>{turn.user_message}</span>
                    </div>
                  )
                ) : (
                  <div className="user-bubble">{turn.user_message}</div>
                ))}

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
                        : turn.user_message.toLowerCase().includes("perception") ||
                          turn.user_message.toLowerCase().includes("examine")
                        ? "Narrator (Perception & Lore)"
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

                  {roll && (
                    <span className="badge badge-dice" title={roll.narrative_directive}>
                      <Dices size={13} />
                      {roll.skill_or_approach}: d20({roll.d20_raw})
                      {roll.modifier >= 0 ? `+${roll.modifier}` : roll.modifier} ={" "}
                      {roll.total} vs DC {roll.difficulty_class} [{roll.outcome_tier}]
                    </span>
                  )}

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
              <div className="cognition-box">
                <div
                  className="cognition-header"
                  onClick={() => toggleCognition(turn.id)}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {isNarratorTurn ? <Eye size={14} color="var(--accent-cyan)" /> : <Brain size={14} />}
                    {isNarratorTurn
                      ? "Objective Scene Observation (Detached & Indifferent)"
                      : `${character.name} Inner Cognition (Recall → Feel → Want → Plan)`}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {!isNarratorTurn && (
                      <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>
                        Valence {turn.cognition.valence >= 0 ? "+" : ""}
                        {turn.cognition.valence.toFixed(2)} | Arousal{" "}
                        {turn.cognition.arousal.toFixed(2)}
                      </span>
                    )}
                    {cogOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </span>
                </div>

                {cogOpen && (
                  isNarratorTurn ? (
                    <div className="cognition-steps">
                      <div className="cog-step">
                        <div className="cog-step-label">Focus Area</div>
                        <div>{turn.cognition.recall || bundle.active_location.name}</div>
                      </div>
                      <div className="cog-step">
                        <div className="cog-step-label">Stance</div>
                        <div>Impersonal, neutral, zero emotional puppeteering or helpful hints.</div>
                      </div>
                      <div className="cog-step">
                        <div className="cog-step-label">Directorial Plan</div>
                        <div>{turn.cognition.plan || "Sensory environmental description"}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="cognition-steps">
                      <div className="cog-step">
                        <div className="cog-step-label">1. Memory Recall</div>
                        <div>{turn.cognition.recall || "Present in the moment."}</div>
                      </div>
                      <div className="cog-step">
                        <div className="cog-step-label">2. Affect & Feeling</div>
                        <div>{turn.cognition.feeling}</div>
                      </div>
                      <div className="cog-step">
                        <div className="cog-step-label">3. Immediate Want</div>
                        <div>{turn.cognition.want}</div>
                      </div>
                      <div className="cog-step">
                        <div className="cog-step-label">4. Tactical Plan</div>
                        <div>{turn.cognition.plan}</div>
                      </div>
                    </div>
                  )
                )}
              </div>

              {/* Narrative Prose */}
              <div className="prose-body">{renderFormattedProse(turn.raw_prose)}</div>

              {/* Turn Footer: Clock, Post-Turn Delta, Swipe/Regenerate, Sibling Branches */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderTop: "1px solid var(--border-subtle)",
                  paddingTop: 8,
                  fontSize: "0.74rem",
                  color: "var(--text-muted)",
                }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span>Turn #{turn.depth_index}</span>
                  <span>• {turn.world_snapshot.world_timestamp}</span>
                  {turn.post_turn?.notable_event_summary && (
                    <span style={{ color: "var(--accent-amber)" }}>
                      ★ {turn.post_turn.notable_event_summary}
                    </span>
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
                          onClick={() => onCheckoutTurn(sib.id)}
                        >
                          v{idx + 1}
                        </button>
                      ))}
                    </div>
                  )}

                  {isLastTurn && (
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                      disabled={isStreaming || isDeletingTurn}
                      onClick={() => handleStartEdit(turn)}
                      title="Edit last message and generate a new swipe"
                    >
                      <Edit3 size={12} />
                      Edit
                    </button>
                  )}

                  {!isRoot && (
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                      disabled={isStreaming || isDeletingTurn}
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
                      disabled={isStreaming || isDeletingTurn}
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
          );
        })}

        {/* Active Streaming Turn Preview */}
        {liveStream && (
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
              <div className="user-bubble">{liveStream.userMessage}</div>
            )}
            <div className="meta-strip">
              <span className="badge badge-dice">{liveStream.phaseStatus}</span>
              {liveStream.preTurn?.resolved_roll && (
                <span className="badge badge-dice">
                  <Dices size={13} />
                  Rolled {liveStream.preTurn.resolved_roll.total} vs DC{" "}
                  {liveStream.preTurn.resolved_roll.difficulty_class} [
                  {liveStream.preTurn.resolved_roll.outcome_tier}]
                </span>
              )}
            </div>

            <div className="cognition-box">
              <div className="cognition-header">
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {liveStream.cognitionParsed?.feeling === "Objective / Detached" ? (
                    <Eye size={14} color="var(--accent-cyan)" />
                  ) : (
                    <Brain size={14} />
                  )}
                  {liveStream.cognitionParsed?.feeling === "Objective / Detached"
                    ? "Objective Scene Observation (Detached & Indifferent)"
                    : "Streaming <cognition>..."}
                </span>
              </div>
              {liveStream.cognitionParsed ? (
                liveStream.cognitionParsed.feeling === "Objective / Detached" ? (
                  <div className="cognition-steps">
                    <div className="cog-step">
                      <div className="cog-step-label">Focus Area</div>
                      <div>{liveStream.cognitionParsed.recall || bundle.active_location.name}</div>
                    </div>
                    <div className="cog-step">
                      <div className="cog-step-label">Stance</div>
                      <div>Impersonal, neutral, no emotional puppeteering or helpful hints.</div>
                    </div>
                    <div className="cog-step">
                      <div className="cog-step-label">Directorial Plan</div>
                      <div>{liveStream.cognitionParsed.plan || "Sensory environmental description"}</div>
                    </div>
                  </div>
                ) : (
                  <div className="cognition-steps">
                    <div className="cog-step">
                      <div className="cog-step-label">1. Recall</div>
                      <div>{liveStream.cognitionParsed.recall}</div>
                    </div>
                    <div className="cog-step">
                      <div className="cog-step-label">2. Feeling</div>
                      <div>{liveStream.cognitionParsed.feeling}</div>
                    </div>
                    <div className="cog-step">
                      <div className="cog-step-label">3. Want</div>
                      <div>{liveStream.cognitionParsed.want}</div>
                    </div>
                    <div className="cog-step">
                      <div className="cog-step-label">4. Plan</div>
                      <div>{liveStream.cognitionParsed.plan}</div>
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
                  {liveStream.cognitionRaw || "Analyzing scene & recalling memories..."}
                </pre>
              )}
            </div>

            {liveStream.proseText && (
              <div className="prose-body">
                {renderFormattedProse(liveStream.proseText)}
              </div>
            )}
          </div>
        )}

        {streamError && (
          <div
            className="turn-card"
            style={{
              borderColor: "var(--accent-rose)",
              background: "rgba(244, 63, 94, 0.1)",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ fontSize: "0.82rem", color: "#fda4af" }}>
              <strong>Ollama / LLM Error:</strong> {streamError}
            </div>
            {onOpenSettings && (
              <button
                type="button"
                className="btn btn-amber"
                onClick={onOpenSettings}
              >
                Configure Ollama Models
              </button>
            )}
          </div>
        )}
      </div>

      {/* Quick Action Bar + Composer */}
      <form className="composer-bar" onSubmit={handleSend}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {/* Dedicated Narrator Action Chips */}
          <button
            type="button"
            className="btn narrator-quick-chip"
            onClick={() => handleInvokeNarrator("describe")}
            title="Describe current scene [/look]"
          >
            <Eye size={11} color="var(--accent-cyan)" />
            <span>Look Around</span>
          </button>

          <button
            type="button"
            className={`btn narrator-quick-chip ${isDurationPickerOpen ? "active" : ""}`}
            onClick={() => {
              setIsCustomDirectiveOpen(false);
              setIsDurationPickerOpen((prev) => !prev);
            }}
            title="Advance in-game time [/wait]"
          >
            <Clock size={11} color="var(--accent-amber)" />
            <span>Pass Time</span>
          </button>

          <button
            type="button"
            className="btn narrator-quick-chip"
            onClick={() => handleInvokeNarrator("complication")}
            title="Introduce external complication [/event]"
          >
            <AlertTriangle size={11} color="var(--accent-rose)" />
            <span>Complication</span>
          </button>

          <button
            type="button"
            className="btn narrator-quick-chip"
            onClick={() => handleInvokeNarrator("perception")}
            title="Scrutinize details and lore [/perception]"
          >
            <Brain size={11} color="var(--accent-violet)" />
            <span>Perception</span>
          </button>

          <button
            type="button"
            className={`btn narrator-quick-chip ${isCustomDirectiveOpen ? "active" : ""}`}
            onClick={() => {
              setIsDurationPickerOpen(false);
              setIsCustomDirectiveOpen((prev) => !prev);
            }}
            title="Direct the neutral narrator with a custom prompt [/narrate]"
          >
            <Sparkles size={11} color="var(--accent-amber)" />
            <span>Custom Narrator Directive</span>
          </button>

          <div style={{ height: 14, width: 1, background: "var(--border-subtle)" }} />

          <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
            Quick Exits:
          </span>
          {bundle.neighbor_locations.map((nb) => (
            <button
              key={nb.edge_id}
              type="button"
              className="btn"
              style={{ padding: "3px 8px", fontSize: "0.72rem" }}
              onClick={() =>
                setInputText(
                  `Let's head through the ${nb.direction_label.toLowerCase()} into ${nb.destination.name}.`
                )
              }
            >
              <Compass size={11} color="var(--accent-cyan)" />
              {nb.destination.name} ({nb.travel_minutes}m)
            </button>
          ))}

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <Dices size={14} color="var(--accent-amber)" />
            <input
              type="number"
              min={1}
              max={20}
              placeholder="d20 auto"
              value={diceOverride}
              onChange={(e) => setDiceOverride(e.target.value)}
              className="field-input"
              style={{ width: 86, padding: "3px 7px", fontSize: "0.74rem" }}
              title="Optional manual d20 roll override (1-20)"
            />
          </div>
        </div>

        {/* Quick Duration Picker Bar */}
        {isDurationPickerOpen && (
          <div className="narrator-duration-picker">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: "0.74rem", color: "var(--accent-amber)", fontWeight: 600, display: "flex", alignItems: "center", gap: 5 }}>
                <Clock size={13} />
                How much in-game time should elapse without player actions?
              </span>
              <button
                type="button"
                className="btn"
                style={{ padding: "1px 6px", border: "none" }}
                onClick={() => setIsDurationPickerOpen(false)}
              >
                <X size={12} />
              </button>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button"
                className="btn btn-duration"
                onClick={() => handleInvokeNarrator("advance", undefined, 5)}
              >
                5 min
              </button>
              <button
                type="button"
                className="btn btn-duration"
                onClick={() => handleInvokeNarrator("advance", undefined, 15)}
              >
                15 min
              </button>
              <button
                type="button"
                className="btn btn-duration"
                onClick={() => handleInvokeNarrator("advance", undefined, 30)}
              >
                30 min
              </button>
              <button
                type="button"
                className="btn btn-duration"
                onClick={() => handleInvokeNarrator("advance", undefined, 60)}
              >
                1 hour
              </button>
              <button
                type="button"
                className="btn btn-duration"
                onClick={() => handleInvokeNarrator("advance", undefined, 240)}
              >
                4 hours
              </button>
              <button
                type="button"
                className="btn btn-duration"
                onClick={() => handleInvokeNarrator("advance", "wait until dawn / morning")}
              >
                Until Morning
              </button>
            </div>
          </div>
        )}

        {/* Custom Director Directive Drawer */}
        {isCustomDirectiveOpen && (
          <div className="narrator-directive-box">
            <div className="narrator-directive-header">
              <Sparkles size={13} color="var(--accent-amber)" />
              <span>Direct the Neutral Narrator</span>
              <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginLeft: "auto" }}>
                Objective, sensory, or atmospheric focus
              </span>
              <button
                type="button"
                className="btn"
                style={{ padding: "2px 6px", border: "none" }}
                onClick={() => setIsCustomDirectiveOpen(false)}
              >
                <X size={12} />
              </button>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                className="field-input"
                autoFocus
                placeholder="What should the narrator focus on? (e.g. 'A sudden tremor shakes the catwalk', 'Describe the rain starting outside')..."
                value={customDirectiveText}
                onChange={(e) => setCustomDirectiveText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && customDirectiveText.trim() && !isStreaming) {
                    e.preventDefault();
                    handleSendCustomDirective();
                  } else if (e.key === "Escape") {
                    setIsCustomDirectiveOpen(false);
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-amber"
                style={{ padding: "3px 14px", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}
                disabled={isStreaming || !customDirectiveText.trim()}
                onClick={handleSendCustomDirective}
              >
                <Send size={12} />
                Invoke
              </button>
            </div>
          </div>
        )}

        <div className="composer-row">
          <textarea
            className="composer-input"
            placeholder={`Write your action or dialogue to ${character.name}... (Or try /look, /wait 30m, /event, /perception, /narrate)`}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend(e);
              }
            }}
          />
          <button
            type="submit"
            className="btn btn-amber"
            style={{ padding: "0 18px" }}
            disabled={isStreaming || !inputText.trim()}
          >
            <Send size={16} />
            Send
          </button>
        </div>
      </form>
    </main>
  );
};
