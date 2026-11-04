import React, { useEffect, useMemo, useRef, useState } from "react";
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
  Lock,
  LogOut,
  MapPin,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  CampaignStateBundle,
  CharacterChoiceOption,
  CharacterChoiceSet,
  CharacterRecord,
  ChoiceGate,
  ChoicePreviewResponse,
  CognitionBlock,
  ComposerPopoverId,
  ComposerTrayId,
  DEFAULT_GATE_DC,
  DiceMode,
  DiceRollResult,
  MAX_CHOICE_LABEL_LENGTH,
  MAX_CHOICE_OPTIONS,
  NarrativeMode,
  NeighborLocationView,
  Phase3TurnProgress,
  Phase4TurnProgress,
  PreTurnAnalysis,
  RecalledMemoryItem,
  TurnNodeRecord,
} from "../types";
import { api } from "../api";
import {
  isChoiceSlashCommand,
  parseChoiceSlashCommand,
} from "../utils/choiceCommand";
import { useMagicWand } from "../hooks/useMagicWand";
import { MagicWandButton } from "./MagicWandButton";

function getTierBadgeClass(tier?: string): string {
  switch (tier) {
    case "Critical Success":
      return "badge-dice-crit-success";
    case "Clean Success":
      return "badge-dice-clean-success";
    case "Simple Failure":
    case "Partial Success":
      return "badge-dice-simple-failure";
    case "Failure with Consequences":
    case "Failure with Consequence":
      return "badge-dice-consequence-failure";
    case "Critical Failure":
      return "badge-dice-crit-failure";
    default:
      return "";
  }
}
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
  pendingLocationOverrideId?: string | null;
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
    diceMode?: DiceMode;
    manualDiceOverride?: number | null;
    narrativeMode?: NarrativeMode;
    narratorDirective?: string | null;
    durationMinutes?: number | null;
    characterChoices?: Record<string, CharacterChoiceSet>;
  }) => void;
  onCheckoutTurn: (turnId: string) => void;
  onDeleteLastTurn?: () => Promise<void> | void;
  onCloseCampaign?: () => void;
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
  pendingLocationOverrideId,
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
  onCloseCampaign,
}) => {
  const isBusy = isStreaming || isPhase4Running;
  const [inputText, setInputText] = useState("");
  const [diceMode, setDiceMode] = useState<DiceMode>("auto");
  const [diceOverride, setDiceOverride] = useState<string>("");
  const [openCognitionIds, setOpenCognitionIds] = useState<Record<string, boolean>>({});
  const [showRetainedIds, setShowRetainedIds] = useState<Record<string, boolean>>({});
  const [selectedCognitionCharIdByTurn, setSelectedCognitionCharIdByTurn] = useState<Record<string, string>>({});
  const [selectedLiveCognitionCharId, setSelectedLiveCognitionCharId] = useState<string | null>(null);
  const [openMemoryIds, setOpenMemoryIds] = useState<Record<string, boolean>>({});
  const [editingTurnId, setEditingTurnId] = useState<string | null>(null);
  const [editMessageText, setEditMessageText] = useState("");
  const [editDiceMode, setEditDiceMode] = useState<DiceMode>("auto");
  const [editDiceOverride, setEditDiceOverride] = useState<string>("");
  const [isDeletingTurn, setIsDeletingTurn] = useState(false);
  const [customDirectiveText, setCustomDirectiveText] = useState("");
  const [activeAgentModal, setActiveAgentModal] = useState<ActiveAgentModalTarget | null>(null);

  // Consolidated Popover & Tray State
  const [activePopover, setActivePopover] = useState<ComposerPopoverId>("none");
  const [activeTray, setActiveTray] = useState<ComposerTrayId>("none");

  // DOM Refs for focus management and outside click handling
  const composerBarRef = useRef<HTMLFormElement | null>(null);
  const narratorBtnRef = useRef<HTMLButtonElement | null>(null);
  const exitsBtnRef = useRef<HTMLButtonElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Director Choices State
  const [stagedChoices, setStagedChoices] = useState<Record<string, CharacterChoiceSet>>({});
  const [activeChoiceCharId, setActiveChoiceCharId] = useState<string>(character.id);
  const [choicePreview, setChoicePreview] = useState<ChoicePreviewResponse | null>(null);
  const [, setIsPreviewLoading] = useState(false);

  // Magic Wand Integration
  const lastBranchTurn =
    bundle.active_branch_turns[bundle.active_branch_turns.length - 1];
  const wandContextKey = `${bundle.campaign.id}:${lastBranchTurn?.id ?? "root"}:${
    pendingLocationOverrideId ?? bundle.active_location.id
  }`;

  const magicWand = useMagicWand({
    fieldRole: "player_turn_prompt",
    value: inputText,
    onChange: setInputText,
    contextRef: {
      scope: "campaign_turn",
      campaign_id: bundle.campaign.id,
      parent_turn_id: lastBranchTurn?.id ?? null,
      override_location_id: pendingLocationOverrideId ?? null,
    },
    contextKey: wandContextKey,
    disabled: isBusy,
    maxWords: 120,
  });

  // Global escape & outside click listener for popovers/drawers
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (activePopover === "none") return;
      if (
        composerBarRef.current &&
        !composerBarRef.current.contains(e.target as Node)
      ) {
        setActivePopover("none");
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (activePopover !== "none") {
          const prev = activePopover;
          setActivePopover("none");
          if (prev === "narrator" && narratorBtnRef.current) narratorBtnRef.current.focus();
          if (prev === "exits" && exitsBtnRef.current) exitsBtnRef.current.focus();
        } else if (activeTray !== "none") {
          setActiveTray("none");
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activePopover, activeTray]);

  const presentCharacters = useMemo(() => {
    const rawIds =
      bundle.present_character_ids && bundle.present_character_ids.length > 0
        ? bundle.present_character_ids
        : [character.id];
    const uniqueIds = Array.from(new Set([character.id, ...rawIds]));
    return uniqueIds.map((id) => {
      const rec = bundle.character_records?.[id];
      if (rec) return rec;
      if (id === character.id) return character;
      return { id, name: "Character" } as CharacterRecord;
    });
  }, [bundle.present_character_ids, bundle.character_records, character]);

  useEffect(() => {
    if (!presentCharacters.some((c) => c.id === activeChoiceCharId)) {
      setActiveChoiceCharId(character.id);
    }
  }, [presentCharacters, activeChoiceCharId, character.id]);

  const activeCharRecord = useMemo(() => {
    return (
      presentCharacters.find((c) => c.id === activeChoiceCharId) || character
    );
  }, [presentCharacters, activeChoiceCharId, character]);

  const hasActiveGates = useMemo(() => {
    return Object.values(stagedChoices).some((cs) =>
      cs.options.some((opt) => opt.gate && opt.gate !== "any")
    );
  }, [stagedChoices]);

  const totalStagedOptionsCount = useMemo(() => {
    return Object.values(stagedChoices).reduce(
      (acc, cs) => acc + (cs.options ? cs.options.length : 0),
      0
    );
  }, [stagedChoices]);

  const choiceSlashWarning = useMemo(() => {
    if (!isChoiceSlashCommand(inputText)) return null;
    const body = inputText.trim().replace(/^\/choices?\s*/i, "").trim();
    const colonIdx = body.indexOf(":");
    const optionsPart =
      colonIdx !== -1
        ? body.slice(colonIdx + 1).trim()
        : body.includes("|")
        ? body
        : "";
    if (!optionsPart) return null;
    const segments = optionsPart.split("|");
    const overLimit = segments
      .map((s) =>
        s
          .replace(
            /@(critfail|botch|crit(?:ical)?|success|pass|fail(?:ure)?|any)\b/i,
            ""
          )
          .trim()
      )
      .filter((lbl) => lbl.length > MAX_CHOICE_LABEL_LENGTH);
    if (overLimit.length > 0) {
      return `Choice label exceeds ${MAX_CHOICE_LABEL_LENGTH} character limit (will be trimmed)`;
    }
    return null;
  }, [inputText]);

  // Decision D2: When gate choices are staged, promote disabled dice mode to auto
  useEffect(() => {
    if (hasActiveGates && diceMode === "disabled") {
      setDiceMode("auto");
    }
  }, [hasActiveGates, diceMode]);

  // Decision D4: Preview choice odds from backend (structured gate signature avoids churn)
  const activeCharChoiceSet = stagedChoices[activeChoiceCharId];
  const activeCharGateSignature = useMemo(() => {
    if (!activeCharChoiceSet || !activeCharChoiceSet.options) return "";
    return activeCharChoiceSet.options.map((o) => `${o.id}:${o.gate}`).join("|");
  }, [activeCharChoiceSet]);

  useEffect(() => {
    if (
      !activeCharChoiceSet ||
      !activeCharChoiceSet.options ||
      activeCharChoiceSet.options.length === 0
    ) {
      setChoicePreview(null);
      return;
    }

    const controller = new AbortController();
    setIsPreviewLoading(true);

    const parsedOverride =
      diceMode === "forced" && diceOverride.trim() !== ""
        ? parseInt(diceOverride.trim(), 10)
        : null;

    api
      .previewChoices(
        {
          choice_set: {
            character_id: activeCharChoiceSet.character_id || activeChoiceCharId,
            options: (activeCharChoiceSet.options || []).map((o) => ({
              id: o.id,
              label: o.label || "",
              gate: o.gate || "any",
            })),
            gate_difficulty_class:
              activeCharChoiceSet.gate_difficulty_class ?? DEFAULT_GATE_DC,
          },
          dice_mode: diceMode,
          manual_dice_override:
            parsedOverride !== null && !isNaN(parsedOverride)
              ? parsedOverride
              : null,
        },
        controller.signal
      )
      .then((res) => {
        setChoicePreview(res);
        setIsPreviewLoading(false);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setIsPreviewLoading(false);
        }
      });

    return () => controller.abort();
  }, [
    activeChoiceCharId,
    activeCharGateSignature,
    activeCharChoiceSet?.gate_difficulty_class,
    diceMode,
    diceOverride,
  ]);

  const handleAddOption = (charId: string) => {
    setStagedChoices((prev) => {
      const existing = prev[charId] || {
        character_id: charId,
        options: [],
        gate_difficulty_class: DEFAULT_GATE_DC,
      };
      if (existing.options.length >= MAX_CHOICE_OPTIONS) {
        return prev;
      }
      const newOpt: CharacterChoiceOption = {
        id: `opt_${Date.now()}_${existing.options.length + 1}`,
        label: "",
        gate: "any",
      };
      return {
        ...prev,
        [charId]: {
          ...existing,
          options: [...existing.options, newOpt],
        },
      };
    });
  };

  const handleUpdateOption = (
    charId: string,
    optId: string,
    updates: Partial<CharacterChoiceOption>
  ) => {
    setStagedChoices((prev) => {
      const existing = prev[charId];
      if (!existing) return prev;
      return {
        ...prev,
        [charId]: {
          ...existing,
          options: existing.options.map((opt) =>
            opt.id === optId
              ? {
                  ...opt,
                  ...updates,
                  ...(updates.label !== undefined
                    ? {
                        label: updates.label.slice(0, MAX_CHOICE_LABEL_LENGTH),
                      }
                    : {}),
                }
              : opt
          ),
        },
      };
    });
  };

  const handleRemoveOption = (charId: string, optId: string) => {
    setStagedChoices((prev) => {
      const existing = prev[charId];
      if (!existing) return prev;
      const remaining = existing.options.filter((opt) => opt.id !== optId);
      if (remaining.length === 0) {
        const copy = { ...prev };
        delete copy[charId];
        return copy;
      }
      return {
        ...prev,
        [charId]: {
          ...existing,
          options: remaining,
        },
      };
    });
  };

  const handleSetDC = (charId: string, dc: number) => {
    setStagedChoices((prev) => {
      const existing = prev[charId] || {
        character_id: charId,
        options: [],
        gate_difficulty_class: dc,
      };
      return {
        ...prev,
        [charId]: {
          ...existing,
          gate_difficulty_class: dc,
        },
      };
    });
  };

  const handleClearCharChoices = (charId: string) => {
    setStagedChoices((prev) => {
      const copy = { ...prev };
      delete copy[charId];
      return copy;
    });
  };

  const handleClearAllChoices = () => {
    setStagedChoices({});
  };

  useEffect(() => {
    setEditingTurnId(null);
    setEditMessageText("");
    setEditDiceMode("auto");
    setEditDiceOverride("");
    setActivePopover("none");
    setActiveTray("none");
    setStagedChoices({});
    magicWand.reset();
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
    setActivePopover("none");
    setActiveTray("none");

    if (mode === "custom") {
      setActiveTray("custom_directive");
      return;
    }

    if (mode === "describe") {
      magicWand.reset();
      onSendTurn({
        userMessage: "[Describe the current scene]",
        diceMode: "disabled",
        narrativeMode: "describe",
      });
    } else if (mode === "advance") {
      const durMsg = durationMinutes
        ? `wait for ${durationMinutes} minutes`
        : directive || "wait for a few moments";
      magicWand.reset();
      onSendTurn({
        userMessage: `[Advance the story: ${durMsg}]`,
        diceMode: "disabled",
        narrativeMode: "advance",
        narratorDirective: durMsg,
        durationMinutes: durationMinutes ?? null,
      });
    } else if (mode === "complication") {
      magicWand.reset();
      onSendTurn({
        userMessage: directive
          ? `[Introduce a complication: ${directive}]`
          : "[Introduce an unexpected complication or external event]",
        diceMode: "disabled",
        narrativeMode: "complication",
        narratorDirective: directive || "An unexpected complication occurs",
      });
    }
  };

  const handleQuickExit = (nb: NeighborLocationView) => {
    if (isBusy) return;
    setActivePopover("none");
    setActiveTray("none");
    setInputText("");
    setStagedChoices({});
    magicWand.reset();

    const forcedVal =
      diceMode === "forced" && diceOverride.trim() !== ""
        ? parseInt(diceOverride.trim(), 10)
        : null;

    onSendTurn({
      userMessage: `Let's head through the ${nb.direction_label.toLowerCase()} into ${nb.destination.name}.`,
      diceMode: diceMode === "forced" ? "forced" : (nb.is_locked_or_hidden ? "auto" : "disabled"),
      manualDiceOverride: diceMode === "forced" && forcedVal && !isNaN(forcedVal) ? forcedVal : null,
    });
  };

  const handleSendCustomDirective = () => {
    const trimmed = customDirectiveText.trim();
    if (!trimmed || isBusy) return;
    magicWand.reset();
    onSendTurn({
      userMessage: trimmed,
      diceMode: "disabled",
      narrativeMode: "custom",
      narratorDirective: trimmed,
    });
    setCustomDirectiveText("");
    setActiveTray("none");
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = inputText.trim();
    if ((!raw && totalStagedOptionsCount === 0) || isBusy) return;

    // Check for slash command shortcuts
    if (raw.startsWith("/")) {
      if (isChoiceSlashCommand(raw)) {
        const parsed = parseChoiceSlashCommand(raw, presentCharacters);
        if (parsed && parsed.choiceSet.options.length > 0) {
          const targetId = parsed.choiceSet.character_id;
          setStagedChoices((prev) => ({
            ...prev,
            [targetId]: parsed.choiceSet,
          }));
          setActiveChoiceCharId(targetId);
          setActiveTray("choices");
          setInputText("");
          magicWand.reset();
          return;
        } else if (parsed && parsed.matchedCharacter) {
          setActiveChoiceCharId(parsed.matchedCharacter.id);
          setActiveTray("choices");
          setInputText("");
          magicWand.reset();
          return;
        }
      }

      const parts = raw.slice(1).split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const arg = parts.slice(1).join(" ").trim();

      if (cmd === "look" || cmd === "scene" || cmd === "describe") {
        setInputText("");
        setDiceMode("auto");
        setDiceOverride("");
        magicWand.reset();
        handleInvokeNarrator("describe");
        return;
      }
      if (cmd === "wait" || cmd === "pass") {
        setInputText("");
        setDiceMode("auto");
        setDiceOverride("");
        magicWand.reset();
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
        setDiceMode("auto");
        setDiceOverride("");
        magicWand.reset();
        handleInvokeNarrator("complication", arg || undefined);
        return;
      }
      if (cmd === "narrate" || cmd === "direct" || cmd === "custom") {
        setInputText("");
        setDiceMode("auto");
        setDiceOverride("");
        magicWand.reset();
        if (arg) {
          onSendTurn({
            userMessage: arg,
            diceMode: "disabled",
            narrativeMode: "custom",
            narratorDirective: arg,
          });
        } else {
          setActiveTray("custom_directive");
        }
        return;
      }
    }

    let parsedDice: number | null = null;
    if (diceMode === "forced" && diceOverride.trim() !== "") {
      const val = parseInt(diceOverride.trim(), 10);
      if (isNaN(val) || val < 1 || val > 20) {
        return;
      }
      parsedDice = val;
    }

    let effectiveChoices: Record<string, CharacterChoiceSet> | undefined = undefined;
    if (totalStagedOptionsCount > 0) {
      const cleaned: Record<string, CharacterChoiceSet> = {};
      for (const [cid, cs] of Object.entries(stagedChoices)) {
        const validOpts = cs.options
          .filter((o) => o.label.trim().length > 0)
          .slice(0, MAX_CHOICE_OPTIONS)
          .map((o) => ({
            ...o,
            label: o.label.trim().slice(0, MAX_CHOICE_LABEL_LENGTH),
          }));
        if (validOpts.length > 0) {
          cleaned[cid] = {
            ...cs,
            options: validOpts,
          };
        }
      }
      if (Object.keys(cleaned).length > 0) {
        effectiveChoices = cleaned;
      }
    }

    onSendTurn({
      userMessage: raw,
      diceMode,
      manualDiceOverride: diceMode === "forced" ? parsedDice : null,
      characterChoices: effectiveChoices,
    });
    setInputText("");
    setDiceMode("auto");
    setDiceOverride("");
    setStagedChoices({});
    setActiveTray("none");
    setActivePopover("none");
    magicWand.reset();
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
      const directive = dirMatch
        ? dirMatch[1].trim()
        : msg.replace(/^\[|\]$/g, "").trim();
      return {
        isNarrator: true,
        narrativeMode: "custom",
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
        diceMode: "disabled",
        narrativeMode: narratorOpts.narrativeMode,
        narratorDirective: narratorOpts.narratorDirective,
        durationMinutes: narratorOpts.durationMinutes,
      });
      return;
    }

    const legacyForced = turn.pre_turn?.resolved_roll?.is_manual_override;
    const savedMode: DiceMode =
      turn.pre_turn?.dice_mode ?? (legacyForced ? "forced" : "auto");
    const savedManual =
      turn.pre_turn?.manual_dice_value ??
      (legacyForced ? turn.pre_turn?.resolved_roll?.d20_raw ?? null : null);

    onSendTurn({
      userMessage: turn.user_message,
      parentTurnId: turn.parent_turn_id,
      diceMode: savedMode,
      manualDiceOverride: savedMode === "forced" ? savedManual : null,
      characterChoices: turn.pre_turn?.character_choices,
    });
  };

  const handleStartEdit = (turn: TurnNodeRecord) => {
    if (isBusy || isDeletingTurn || !turn.parent_turn_id) return;
    setEditingTurnId(turn.id);
    setEditMessageText(turn.user_message);
    const legacyForced = turn.pre_turn?.resolved_roll?.is_manual_override;
    const initialMode: DiceMode =
      turn.pre_turn?.dice_mode ?? (legacyForced ? "forced" : "auto");
    const initialVal =
      turn.pre_turn?.manual_dice_value ??
      (legacyForced ? turn.pre_turn?.resolved_roll?.d20_raw ?? null : null);
    setEditDiceMode(initialMode);
    setEditDiceOverride(initialVal != null ? String(initialVal) : "");
  };

  const handleCancelEdit = () => {
    setEditingTurnId(null);
    setEditMessageText("");
    setEditDiceMode("auto");
    setEditDiceOverride("");
  };

  const handleCommitEdit = (turn: TurnNodeRecord) => {
    const trimmed = editMessageText.trim();
    if (!trimmed || isBusy || isDeletingTurn || !turn.parent_turn_id) return;

    const narratorOpts = inferNarratorTurnOptions(turn, trimmed);
    if (narratorOpts.isNarrator) {
      setEditingTurnId(null);
      setEditMessageText("");
      setEditDiceMode("auto");
      setEditDiceOverride("");
      onSendTurn({
        userMessage: trimmed,
        parentTurnId: turn.parent_turn_id,
        diceMode: "disabled",
        narrativeMode: narratorOpts.narrativeMode,
        narratorDirective: narratorOpts.narratorDirective || trimmed,
        durationMinutes: narratorOpts.durationMinutes,
      });
      return;
    }

    let parsedEditDice: number | null = null;
    if (editDiceMode === "forced" && editDiceOverride.trim() !== "") {
      const val = parseInt(editDiceOverride.trim(), 10);
      if (isNaN(val) || val < 1 || val > 20) {
        return;
      }
      parsedEditDice = val;
    }

    setEditingTurnId(null);
    setEditMessageText("");
    setEditDiceMode("auto");
    setEditDiceOverride("");
    onSendTurn({
      userMessage: trimmed,
      parentTurnId: turn.parent_turn_id,
      diceMode: editDiceMode,
      manualDiceOverride: editDiceMode === "forced" ? parsedEditDice : null,
      characterChoices: turn.pre_turn?.character_choices,
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
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontWeight: 700, fontSize: "1.02rem" }}>
              {bundle.campaign.name}
            </div>
            {onCloseCampaign && (
              <button
                type="button"
                className="btn btn-sm btn-close-campaign"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "2px 8px",
                  fontSize: "0.72rem",
                  color: "var(--text-secondary)",
                }}
                onClick={onCloseCampaign}
                title="Close campaign and return to Home"
              >
                <LogOut size={12} />
                <span>Close Campaign</span>
              </button>
            )}
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
                      {!isNarratorTurn && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginRight: "auto" }}>
                          <button
                            type="button"
                            className={`btn btn-dice-toggle btn-dice-toggle--${editDiceMode}`}
                            onClick={() => {
                              setEditDiceMode((prev) => {
                                if (prev === "auto") return "forced";
                                if (prev === "forced") {
                                  setEditDiceOverride("");
                                  return "disabled";
                                }
                                return "auto";
                              });
                            }}
                            title="Toggle dice roll mode (auto / forced / disabled)"
                          >
                            <Dices size={12} />
                            <span>{editDiceMode}</span>
                          </button>
                          {editDiceMode === "forced" && (
                            <input
                              type="number"
                              min={1}
                              max={20}
                              placeholder="random"
                              value={editDiceOverride}
                              onChange={(e) => setEditDiceOverride(e.target.value)}
                              className={`field-input ${
                                editDiceOverride.trim() !== "" &&
                                (isNaN(parseInt(editDiceOverride, 10)) ||
                                  parseInt(editDiceOverride, 10) < 1 ||
                                  parseInt(editDiceOverride, 10) > 20)
                                  ? "dice-input-invalid"
                                  : ""
                              }`}
                              style={{ width: 68, padding: "2px 6px", fontSize: "0.72rem" }}
                              title="Manual d20 value (1-20), or leave blank for forced random roll"
                            />
                          )}
                        </div>
                      )}
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
                        disabled={
                          isStreaming ||
                          !editMessageText.trim() ||
                          (editDiceMode === "forced" &&
                            editDiceOverride.trim() !== "" &&
                            (isNaN(parseInt(editDiceOverride, 10)) ||
                              parseInt(editDiceOverride, 10) < 1 ||
                              parseInt(editDiceOverride, 10) > 20))
                        }
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
                  ) : (
                    <div className="user-bubble user-bubble-narrator-cue">
                      <Sparkles size={12} color="var(--accent-cyan)" />
                      <span>{turn.user_message}</span>
                    </div>
                  )
                ) : (
                  <div className="user-bubble">{turn.user_message}</div>
                ))}

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
      <form ref={composerBarRef} className="composer-bar" onSubmit={handleSend}>
        {/* Quick Duration Picker Bar */}
        {activeTray === "pass_time" && (
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
                onClick={() => setActiveTray("none")}
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
        {activeTray === "custom_directive" && (
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
                onClick={() => setActiveTray("none")}
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
                    setActiveTray("none");
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

        {/* Director Guided Choices Drawer */}
        {activeTray === "choices" && (
          <div className="choices-drawer-box">
            <div className="choices-drawer-header">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: "#93c5fd",
                  fontWeight: 600,
                  fontSize: "0.78rem",
                }}
              >
                <ListChecks size={14} />
                <span>Director Choices (Guide Character Cognition)</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {totalStagedOptionsCount > 0 && (
                  <button
                    type="button"
                    className="btn"
                    style={{
                      padding: "2px 8px",
                      fontSize: "0.70rem",
                      color: "var(--accent-rose)",
                      border: "none",
                    }}
                    onClick={handleClearAllChoices}
                  >
                    Clear All
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "2px 6px", border: "none" }}
                  onClick={() => setActiveTray("none")}
                >
                  <X size={12} />
                </button>
              </div>
            </div>

            {/* Character selection tabs */}
            <div className="choices-char-tabs">
              {presentCharacters.map((c) => {
                const isSelected = c.id === activeChoiceCharId;
                const optCount = stagedChoices[c.id]?.options?.length || 0;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`choices-char-tab ${
                      isSelected ? "choices-char-tab--active" : ""
                    }`}
                    onClick={() => setActiveChoiceCharId(c.id)}
                  >
                    <span>{c.name}</span>
                    {optCount > 0 && (
                      <span
                        style={{
                          fontSize: "0.64rem",
                          background: isSelected
                            ? "#3b82f6"
                            : "rgba(255,255,255,0.15)",
                          color: "white",
                          padding: "0 5px",
                          borderRadius: 8,
                          fontWeight: 700,
                        }}
                      >
                        {optCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* DC preset and input row for active character */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                fontSize: "0.74rem",
              }}
            >
              <span
                style={{
                  color: "var(--text-muted)",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Dices size={12} />
                Gate DC:
              </span>
              {[
                { label: "Easy 8", val: 8 },
                { label: "Moderate 12", val: 12 },
                { label: "Hard 15", val: 15 },
                { label: "Very Hard 18", val: 18 },
              ].map((preset) => {
                const currentDC =
                  stagedChoices[activeChoiceCharId]?.gate_difficulty_class ??
                  DEFAULT_GATE_DC;
                const isSelected = currentDC === preset.val;
                return (
                  <button
                    key={preset.val}
                    type="button"
                    className="btn"
                    style={{
                      padding: "2px 7px",
                      fontSize: "0.70rem",
                      background: isSelected
                        ? "rgba(59, 130, 246, 0.25)"
                        : undefined,
                      borderColor: isSelected
                        ? "rgba(59, 130, 246, 0.6)"
                        : undefined,
                      color: isSelected ? "#93c5fd" : "var(--text-secondary)",
                    }}
                    onClick={() => handleSetDC(activeChoiceCharId, preset.val)}
                  >
                    {preset.label}
                  </button>
                );
              })}
              <input
                type="number"
                min={1}
                max={30}
                value={
                  stagedChoices[activeChoiceCharId]?.gate_difficulty_class ??
                  DEFAULT_GATE_DC
                }
                onChange={(e) => {
                  const num = parseInt(e.target.value, 10);
                  if (!isNaN(num) && num >= 1 && num <= 30) {
                    handleSetDC(activeChoiceCharId, num);
                  }
                }}
                className="field-input"
                style={{ width: 50, padding: "2px 6px", fontSize: "0.72rem" }}
                title="Custom gate difficulty class (1-30)"
              />
              {stagedChoices[activeChoiceCharId]?.options?.length ? (
                <button
                  type="button"
                  className="btn"
                  style={{
                    marginLeft: "auto",
                    padding: "2px 7px",
                    fontSize: "0.70rem",
                    color: "var(--text-muted)",
                  }}
                  onClick={() => handleClearCharChoices(activeChoiceCharId)}
                >
                  Clear {activeCharRecord?.name || "character"} choices
                </button>
              ) : null}
            </div>

            {/* Options list for active character */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(stagedChoices[activeChoiceCharId]?.options || []).map(
                (opt, idx) => {
                  const isGated = opt.gate && opt.gate !== "any";
                  let oddsLabel: string | null = null;
                  if (isGated && choicePreview?.gate_probabilities) {
                    const prob =
                      choicePreview.gate_probabilities[opt.gate as ChoiceGate];
                    if (typeof prob === "number") {
                      oddsLabel = `${Math.round(prob * 100)}%`;
                    }
                  }

                  return (
                    <div key={opt.id} className="choices-option-row">
                      <span
                        style={{
                          fontSize: "0.72rem",
                          color: "var(--text-muted)",
                          width: 14,
                        }}
                      >
                        {idx + 1}.
                      </span>
                      <input
                        type="text"
                        className="choices-option-input"
                        placeholder="Choice label (e.g. Open the blast door, Back away slowly...)"
                        value={opt.label}
                        maxLength={MAX_CHOICE_LABEL_LENGTH}
                        onChange={(e) =>
                          handleUpdateOption(activeChoiceCharId, opt.id, {
                            label: e.target.value.slice(0, MAX_CHOICE_LABEL_LENGTH),
                          })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddOption(activeChoiceCharId);
                          }
                        }}
                      />
                      <span
                        className={`choices-char-count ${
                          opt.label.length >= MAX_CHOICE_LABEL_LENGTH
                            ? "choices-char-count--limit"
                            : ""
                        }`}
                        title={`Character limit: ${opt.label.length}/${MAX_CHOICE_LABEL_LENGTH}`}
                      >
                        {opt.label.length}/{MAX_CHOICE_LABEL_LENGTH}
                      </span>
                      <select
                        className="choices-gate-select"
                        value={opt.gate || "any"}
                        onChange={(e) =>
                          handleUpdateOption(activeChoiceCharId, opt.id, {
                            gate: e.target.value as ChoiceGate,
                          })
                        }
                      >
                        <option value="any">Always Available (No Gate)</option>
                        <option value="critical_success">
                          Req: Critical Success (d20=20 or DC+10)
                        </option>
                        <option value="success_plus">
                          Req: Success or better (DC met)
                        </option>
                        <option value="failure_minus">
                          Req: Failure or worse (&lt; DC)
                        </option>
                        <option value="critical_failure">
                          Req: Critical Failure (d20=1 or DC-10)
                        </option>
                      </select>

                      {isGated && oddsLabel && (
                        <span
                          className="choices-odds-badge"
                          style={{
                            background: "rgba(59, 130, 246, 0.15)",
                            border: "1px solid rgba(59, 130, 246, 0.4)",
                            color: "#93c5fd",
                          }}
                          title={`Estimated odds under current DC (${
                            stagedChoices[activeChoiceCharId]
                              ?.gate_difficulty_class ?? DEFAULT_GATE_DC
                          }) and dice mode`}
                        >
                          {oddsLabel} odds
                        </span>
                      )}

                      <button
                        type="button"
                        className="btn"
                        style={{
                          padding: "3px 6px",
                          border: "none",
                          color: "var(--accent-rose)",
                        }}
                        onClick={() =>
                          handleRemoveOption(activeChoiceCharId, opt.id)
                        }
                        title="Remove option"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                }
              )}
            </div>

            {/* Add option button & summary banner */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                className="btn"
                style={{
                  padding: "4px 12px",
                  fontSize: "0.72rem",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
                disabled={
                  (stagedChoices[activeChoiceCharId]?.options?.length || 0) >=
                  MAX_CHOICE_OPTIONS
                }
                onClick={() => handleAddOption(activeChoiceCharId)}
                title={
                  (stagedChoices[activeChoiceCharId]?.options?.length || 0) >=
                  MAX_CHOICE_OPTIONS
                    ? `Maximum of ${MAX_CHOICE_OPTIONS} choices reached`
                    : undefined
                }
              >
                <Plus size={12} />
                <span>
                  Add Choice for {activeCharRecord?.name || "Character"}
                  {stagedChoices[activeChoiceCharId]?.options?.length
                    ? ` (${stagedChoices[activeChoiceCharId]?.options?.length}/${MAX_CHOICE_OPTIONS})`
                    : ""}
                </span>
              </button>

              <span style={{ fontSize: "0.70rem", color: "var(--text-muted)" }}>
                Tip: You can also type{" "}
                <code>
                  /choice {activeCharRecord?.name || "name"}: Opt 1 | Opt 2
                  @crit
                </code>
              </span>
            </div>

            {/* Preview Summary Banner */}
            {choicePreview &&
              (stagedChoices[activeChoiceCharId]?.options?.length || 0) > 0 && (
                <div className="choices-preview-summary">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    <Sparkles size={12} color="#93c5fd" />
                    <span>
                      Odds distribution for DC {choicePreview.difficulty_class} (
                      {diceMode} dice):
                    </span>
                    {choicePreview.tier_probabilities &&
                      Object.entries(choicePreview.tier_probabilities).map(
                        ([tier, prob]) => (
                          <span key={tier} style={{ opacity: 0.85 }}>
                            {tier}: <strong>{Math.round(prob * 100)}%</strong>
                          </span>
                        )
                      )}
                  </div>
                  <div>
                    {stagedChoices[activeChoiceCharId]?.options.some(
                      (o) => !o.gate || o.gate === "any"
                    ) ? (
                      <span style={{ color: "#86efac" }}>
                        ✓ Always-available option present
                      </span>
                    ) : (
                      <span
                        style={{ color: "#fde047" }}
                        title="If the roll misses all gated options, the character will decide freely without guidance."
                      >
                        ○ Free fallback if roll conditions fail
                      </span>
                    )}
                  </div>
                </div>
              )}
          </div>
        )}

        {/* Unified Modern Composer Card */}
        <div className="composer-card">
          <div className="composer-input-wrapper">
            <textarea
              ref={textareaRef}
              className="composer-textarea"
              placeholder={
                totalStagedOptionsCount > 0
                  ? "Optional user action / dialogue (Leave blank to let characters act on your staged choices)..."
                  : `Write your action or dialogue to ${character.name}... (Or try /choice, /look, /wait 30m, /narrate)`
              }
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (
                  (e.altKey && e.shiftKey && (e.key === "E" || e.key === "e")) ||
                  (e.ctrlKey && e.shiftKey && (e.key === "E" || e.key === "e"))
                ) {
                  e.preventDefault();
                  if (magicWand.canEnrich) {
                    magicWand.triggerEnrich("auto");
                  }
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend(e);
                }
              }}
            />
            <div className="composer-wand-slot">
              <MagicWandButton
                wand={magicWand}
                isInputEmpty={!inputText.trim()}
                isSlashCommand={inputText.trim().startsWith("/")}
              />
            </div>
          </div>

          {choiceSlashWarning && (
            <div
              style={{
                padding: "5px 12px",
                fontSize: "0.72rem",
                color: "var(--accent-amber)",
                background: "rgba(245, 158, 11, 0.08)",
                borderTop: "1px solid rgba(245, 158, 11, 0.2)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <AlertTriangle size={12} />
              <span>{choiceSlashWarning}</span>
            </div>
          )}

          {/* Composer Footer Bar */}
          <div className="composer-footer">
            <div className="composer-footer-left">
              {/* Narrator Dropdown Trigger & Popover */}
              <div className="composer-popover-anchor">
                <button
                  ref={narratorBtnRef}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={activePopover === "narrator"}
                  className={`btn composer-action-btn ${
                    activePopover === "narrator" ? "active" : ""
                  }`}
                  onClick={() =>
                    setActivePopover((prev) =>
                      prev === "narrator" ? "none" : "narrator"
                    )
                  }
                  title="Narrator actions (Look Around, Pass Time, Complication, Custom Directive)"
                >
                  <Eye size={12} color="var(--accent-cyan)" />
                  <span>Narrator</span>
                  <ChevronDown size={11} style={{ opacity: 0.7 }} />
                </button>

                {activePopover === "narrator" && (
                  <div className="composer-flyout-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      className="composer-flyout-item"
                      onClick={() => handleInvokeNarrator("describe")}
                    >
                      <Eye size={13} color="var(--accent-cyan)" />
                      <div className="composer-flyout-item-text">
                        <strong>Look Around</strong>
                        <span>Sensory description of current scene [/look]</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="composer-flyout-item"
                      onClick={() => {
                        setActivePopover("none");
                        setActiveTray("pass_time");
                      }}
                    >
                      <Clock size={13} color="var(--accent-amber)" />
                      <div className="composer-flyout-item-text">
                        <strong>Pass Time...</strong>
                        <span>Advance in-game clock without action [/wait]</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="composer-flyout-item"
                      onClick={() => handleInvokeNarrator("complication")}
                    >
                      <AlertTriangle size={13} color="var(--accent-rose)" />
                      <div className="composer-flyout-item-text">
                        <strong>Complication</strong>
                        <span>Introduce unexpected external event [/event]</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="composer-flyout-item"
                      onClick={() => {
                        setActivePopover("none");
                        setActiveTray("custom_directive");
                      }}
                    >
                      <Sparkles size={13} color="var(--accent-amber)" />
                      <div className="composer-flyout-item-text">
                        <strong>Custom Directive...</strong>
                        <span>Direct narrator with custom guidance [/narrate]</span>
                      </div>
                    </button>
                  </div>
                )}
              </div>

              {/* Quick Exits Dropdown Trigger & Popover */}
              <div className="composer-popover-anchor">
                <button
                  ref={exitsBtnRef}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={activePopover === "exits"}
                  className={`btn composer-action-btn ${
                    activePopover === "exits" ? "active" : ""
                  }`}
                  disabled={bundle.neighbor_locations.length === 0}
                  onClick={() =>
                    setActivePopover((prev) =>
                      prev === "exits" ? "none" : "exits"
                    )
                  }
                  title="Immediate exits from this location"
                >
                  <Compass size={12} color="var(--accent-cyan)" />
                  <span>Exits ({bundle.neighbor_locations.length})</span>
                  <ChevronDown size={11} style={{ opacity: 0.7 }} />
                </button>

                {activePopover === "exits" &&
                  bundle.neighbor_locations.length > 0 && (
                    <div className="composer-flyout-menu exits-menu" role="menu">
                      <div className="composer-flyout-header">
                        <Compass size={11} />
                        <span>Connected Paths (Click to Travel)</span>
                      </div>
                      {bundle.neighbor_locations.map((nb) => (
                        <button
                          key={nb.edge_id}
                          type="button"
                          role="menuitem"
                          className="composer-flyout-item exit-item"
                          disabled={isBusy}
                          onClick={() => handleQuickExit(nb)}
                        >
                          <span className="exit-compass-tag">
                            {nb.compass_direction || "PATH"}
                          </span>
                          <div className="composer-flyout-item-text">
                            <strong>{nb.destination.name}</strong>
                            <span>
                              via {nb.direction_label} • {nb.travel_minutes}m
                            </span>
                          </div>
                          {nb.is_locked_or_hidden && (
                            <span
                              className="badge badge-locked"
                              title="Locked or hidden passage"
                            >
                              <Lock size={10} />
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
              </div>

              {/* Director Choices Button */}
              <button
                type="button"
                className={`btn composer-action-btn ${
                  activeTray === "choices" ? "active" : ""
                }`}
                style={{
                  borderColor:
                    totalStagedOptionsCount > 0
                      ? "rgba(59, 130, 246, 0.5)"
                      : undefined,
                  background:
                    totalStagedOptionsCount > 0
                      ? "rgba(59, 130, 246, 0.15)"
                      : undefined,
                  color: totalStagedOptionsCount > 0 ? "#93c5fd" : undefined,
                }}
                onClick={() => {
                  setActivePopover("none");
                  setActiveTray((prev) =>
                    prev === "choices" ? "none" : "choices"
                  );
                }}
                title="Present character choices to guide cognition [/choice]"
              >
                <ListChecks
                  size={12}
                  color={
                    totalStagedOptionsCount > 0
                      ? "#93c5fd"
                      : "var(--accent-blue)"
                  }
                />
                <span>Choices</span>
                {totalStagedOptionsCount > 0 && (
                  <span className="composer-count-badge">
                    {totalStagedOptionsCount}
                  </span>
                )}
              </button>
            </div>

            <div className="composer-footer-right">
              {/* Dice Mode Toggle & Override Input */}
              <button
                type="button"
                className={`btn btn-dice-toggle btn-dice-toggle--${diceMode}`}
                onClick={() => {
                  setDiceMode((prev) => {
                    if (prev === "auto") return "forced";
                    if (prev === "forced") {
                      setDiceOverride("");
                      if (hasActiveGates) {
                        return "auto";
                      }
                      return "disabled";
                    }
                    return "auto";
                  });
                }}
                title={
                  hasActiveGates
                    ? "Dice Mode: Auto or Forced (Disabled locked while gate choices are active)"
                    : "Dice Mode: Click to cycle between auto, forced, and disabled"
                }
              >
                <Dices size={13} />
                <span>{diceMode}</span>
              </button>

              {diceMode === "forced" && (
                <input
                  type="number"
                  min={1}
                  max={20}
                  placeholder="rnd"
                  value={diceOverride}
                  onChange={(e) => setDiceOverride(e.target.value)}
                  className={`field-input ${
                    diceOverride.trim() !== "" &&
                    (isNaN(parseInt(diceOverride, 10)) ||
                      parseInt(diceOverride, 10) < 1 ||
                      parseInt(diceOverride, 10) > 20)
                      ? "dice-input-invalid"
                      : ""
                  }`}
                  style={{
                    width: 54,
                    padding: "3px 6px",
                    fontSize: "0.74rem",
                  }}
                  title="Manual d20 roll (1-20), or blank for forced random"
                />
              )}

              {/* Send Button */}
              <button
                type="submit"
                className="btn btn-amber composer-send-btn"
                disabled={
                  isBusy ||
                  (!inputText.trim() && totalStagedOptionsCount === 0) ||
                  (diceMode === "forced" &&
                    diceOverride.trim() !== "" &&
                    (isNaN(parseInt(diceOverride, 10)) ||
                      parseInt(diceOverride, 10) < 1 ||
                      parseInt(diceOverride, 10) > 20))
                }
              >
                <Send size={14} />
                <span>Send</span>
              </button>
            </div>
          </div>
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
