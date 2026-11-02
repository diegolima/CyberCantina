import React, { useEffect, useState } from "react";
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
  Phase3TurnProgress,
  Phase4TurnProgress,
  PreTurnAnalysis,
  RecalledMemoryItem,
  TurnNodeRecord,
} from "../types";
import {
  ActiveAgentModalTarget,
  AgentChangesModal,
} from "./inspector/AgentChangesModal";

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
  isPhase4Running?: boolean;
  phase3Progress?: Phase3TurnProgress | null;
  phase4ProgressByTurn?: Record<string, Phase4TurnProgress>;
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
  isPhase4Running = false,
  phase3Progress = null,
  phase4ProgressByTurn = {},
  liveStream,
  streamError,
  onOpenSettings,
  onSendTurn,
  onCheckoutTurn,
  onDeleteLastTurn,
}) => {
  const isBusy = isStreaming || isPhase4Running;
  const [inputText, setInputText] = useState("");
  const [diceOverride, setDiceOverride] = useState<string>("");
  const [openCognitionIds, setOpenCognitionIds] = useState<Record<string, boolean>>({});
  const [showRetainedIds, setShowRetainedIds] = useState<Record<string, boolean>>({});
  const [selectedCognitionCharIdByTurn, setSelectedCognitionCharIdByTurn] = useState<Record<string, string>>({});
  const [selectedLiveCognitionCharId, setSelectedLiveCognitionCharId] = useState<string | null>(null);
  const [openMemoryIds, setOpenMemoryIds] = useState<Record<string, boolean>>({});
  const [editingTurnId, setEditingTurnId] = useState<string | null>(null);
  const [editMessageText, setEditMessageText] = useState("");
  const [isDeletingTurn, setIsDeletingTurn] = useState(false);
  const [isDurationPickerOpen, setIsDurationPickerOpen] = useState(false);
  const [isCustomDirectiveOpen, setIsCustomDirectiveOpen] = useState(false);
  const [customDirectiveText, setCustomDirectiveText] = useState("");
  const [activeAgentModal, setActiveAgentModal] = useState<ActiveAgentModalTarget | null>(null);

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

  const toggleRetained = (id: string) => {
    setShowRetainedIds((prev) => ({ ...prev, [id]: !prev[id] }));
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
    if (!trimmed || isBusy) return;
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
    if (!raw || isBusy) return;

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
    if (isBusy || isDeletingTurn || !turn.parent_turn_id) return;
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
    if (isBusy || isDeletingTurn || !turn.parent_turn_id) return;
    setEditingTurnId(turn.id);
    setEditMessageText(turn.user_message);
  };

  const handleCancelEdit = () => {
    setEditingTurnId(null);
    setEditMessageText("");
  };

  const handleCommitEdit = (turn: TurnNodeRecord) => {
    const trimmed = editMessageText.trim();
    if (!trimmed || isBusy || isDeletingTurn || !turn.parent_turn_id) return;
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
    if (isBusy || isDeletingTurn || !onDeleteLastTurn) return;
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
              {(() => {
                const isNarratorTurn =
                  turn.user_message.startsWith("[NARRATOR DIRECTIVE]");
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

                const isSkipped =
                  !isNarratorTurn &&
                  Boolean(activeCognition.skipped || !activeCognition.recall);
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
                              Valence {activeCognition.valence >= 0 ? "+" : ""}
                              {activeCognition.valence.toFixed(2)} | Arousal{" "}
                              {activeCognition.arousal.toFixed(2)}
                            </span>
                          )
                        )}
                        {cogOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </span>
                    </div>

                    {cogOpen && (
                      <>
                        {charIds.length > 1 && (
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

              {/* Narrative Prose */}
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
                        disabled={isBusy || isDeletingTurn}
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

              const liveSkipped = Boolean(activeLiveCog?.skipped);
              const isNarratorCue =
                liveStream.cognitionParsed?.feeling === "Objective / Detached";
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

                  {liveCharIds.length > 1 && (
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
                          "Analyzing scene & recalling memories..."}
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
                  if (e.key === "Enter" && customDirectiveText.trim() && !isBusy) {
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
                disabled={isBusy || !customDirectiveText.trim()}
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
            disabled={isBusy || !inputText.trim()}
          >
            <Send size={16} />
            Send
          </button>
        </div>
      </form>

      {/* Phase 4 Clerk & Character Agent Changes Modal */}
      {activeAgentModal && (
        <AgentChangesModal
          target={activeAgentModal}
          bundle={bundle}
          turnProgress={phase4ProgressByTurn[activeAgentModal.turnId]}
          onClose={() => setActiveAgentModal(null)}
        />
      )}
    </main>
  );
};
