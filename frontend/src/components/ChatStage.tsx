import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Clock,
  LogOut,
  MapPin,
} from "lucide-react";
import {
  CharacterChoiceOption,
  CharacterChoiceSet,
  CharacterRecord,
  ChoicePreviewResponse,
  ComposerPopoverId,
  ComposerTrayId,
  DEFAULT_GATE_DC,
  DiceMode,
  MAX_CHOICE_LABEL_LENGTH,
  MAX_CHOICE_OPTIONS,
  NarrativeMode,
  NeighborLocationView,
  TurnNodeRecord,
} from "../types";
import { api } from "../api";
import {
  isChoiceSlashCommand,
  parseChoiceSlashCommand,
} from "../utils/choiceCommand";
import { useMagicWand } from "../hooks/useMagicWand";
import {
  decomposeClientUserMessage,
  normalizeQuotes,
} from "../utils/mentions";
import {
  ActiveAgentModalTarget,
  AgentChangesModal,
} from "./inspector/AgentChangesModal";
import type { ChatStageProps } from "./chat/chatHelpers";
import { TurnCard } from "./chat/TurnCard";
import { LiveStreamingTurnCard } from "./chat/LiveStreamingTurnCard";
import { ChatComposer } from "./chat/ChatComposer";

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
  const [openMemoryIds, setOpenMemoryIds] = useState<Record<string, boolean>>({});
  const [editingTurn, setEditingTurn] = useState<TurnNodeRecord | null>(null);
  const stashedDraftRef = useRef<{
    inputText: string;
    diceMode: DiceMode;
    diceOverride: string;
    stagedChoices: Record<string, CharacterChoiceSet>;
  } | null>(null);
  const handleCancelEditRef = useRef<() => void>(() => {});
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
  const effectiveWandParentId = editingTurn
    ? (editingTurn.parent_turn_id ?? null)
    : (lastBranchTurn?.id ?? null);
  const wandContextKey = `${bundle.campaign.id}:${effectiveWandParentId ?? "root"}:${
    pendingLocationOverrideId ?? bundle.active_location.id
  }:${editingTurn ? `edit-${editingTurn.id}` : "new"}`;

  const magicWand = useMagicWand({
    fieldRole: "player_turn_prompt",
    value: inputText,
    onChange: setInputText,
    contextRef: {
      scope: "campaign_turn",
      campaign_id: bundle.campaign.id,
      parent_turn_id: effectiveWandParentId,
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
        } else if (editingTurn) {
          handleCancelEditRef.current();
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activePopover, activeTray, editingTurn]);

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

  const allCampaignCharacters = useMemo(() => {
    const map = new Map<string, CharacterRecord>();
    if (bundle.character_records) {
      Object.values(bundle.character_records).forEach((c) => {
        if (c && c.id) map.set(c.id, c);
      });
    }
    if (character && character.id) {
      map.set(character.id, character);
    }
    return Array.from(map.values());
  }, [bundle.character_records, character]);

  const presentCharacterIds = useMemo(() => {
    return presentCharacters.map((c) => c.id);
  }, [presentCharacters]);

  // Mention Autocomplete & Whispers State
  const [mentionPickerOpen, setMentionPickerOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);

  const filteredMentionCharacters = useMemo(() => {
    const clean = mentionQuery.trim().toLowerCase();
    if (!clean) return allCampaignCharacters;
    return allCampaignCharacters.filter(
      (c) =>
        c.name.toLowerCase().includes(clean) ||
        (c.tagline && c.tagline.toLowerCase().includes(clean))
    );
  }, [allCampaignCharacters, mentionQuery]);

  useEffect(() => {
    setMentionSelectedIndex(0);
  }, [mentionQuery]);

  const decomposedInput = useMemo(() => {
    return decomposeClientUserMessage(
      inputText,
      allCampaignCharacters,
      presentCharacterIds
    );
  }, [inputText, allCampaignCharacters, presentCharacterIds]);

  const checkAndTriggerMention = (newText: string, cursorOffset?: number) => {
    const textarea = textareaRef.current;
    const cursorPos = cursorOffset ?? textarea?.selectionStart ?? newText.length;
    const textBeforeCursor = newText.slice(0, cursorPos);
    const lastNewlineIdx = textBeforeCursor.lastIndexOf("\n");
    const lineStartIdx = lastNewlineIdx === -1 ? 0 : lastNewlineIdx + 1;
    const lineBeforeCursor = textBeforeCursor.slice(lineStartIdx);

    if (lineBeforeCursor.startsWith("@") && !lineBeforeCursor.includes(":")) {
      setMentionQuery(lineBeforeCursor.slice(1));
      setMentionPickerOpen(true);
    } else {
      setMentionPickerOpen(false);
    }
  };

  const handleSelectMention = (char: CharacterRecord) => {
    const textarea = textareaRef.current;
    const cursorPos = textarea?.selectionStart ?? inputText.length;
    const textBeforeCursor = inputText.slice(0, cursorPos);
    const lastNewlineIdx = textBeforeCursor.lastIndexOf("\n");
    const lineStartIdx = lastNewlineIdx === -1 ? 0 : lastNewlineIdx + 1;

    const nextNewlineIdx = inputText.indexOf("\n", cursorPos);
    const lineFull = inputText.slice(
      lineStartIdx,
      nextNewlineIdx === -1 ? inputText.length : nextNewlineIdx
    );

    const textBeforeLine = inputText.slice(0, lineStartIdx);
    const restOfLine = lineFull.includes(":")
      ? lineFull.slice(lineFull.indexOf(":") + 1)
      : "";
    const textAfterLine =
      nextNewlineIdx === -1 ? "" : inputText.slice(nextNewlineIdx);

    const newPrefix = `@${char.name}: `;
    const newText =
      textBeforeLine + newPrefix + restOfLine.trimStart() + textAfterLine;
    setInputText(newText);
    setMentionPickerOpen(false);

    const newCursorPos = lineStartIdx + newPrefix.length;
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 10);
  };

  const handleRemoveMentionChip = (charName: string) => {
    const lines = inputText.split("\n");
    const filtered = lines.filter((l) => {
      const norm = normalizeQuotes(l).trim();
      return !norm.toLowerCase().startsWith(`@${charName.toLowerCase()}:`);
    });
    setInputText(filtered.join("\n"));
  };

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
    setEditingTurn(null);
    stashedDraftRef.current = null;
    setActivePopover("none");
    setActiveTray("none");
    setStagedChoices({});
    magicWand.reset();
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
          const targetParentId = editingTurn ? editingTurn.parent_turn_id : undefined;
          onSendTurn({
            userMessage: arg,
            parentTurnId: targetParentId,
            diceMode: "disabled",
            narrativeMode: "custom",
            narratorDirective: arg,
          });
          stashedDraftRef.current = null;
          setEditingTurn(null);
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

    const isEditMode = Boolean(editingTurn && editingTurn.parent_turn_id);
    const targetParentId = isEditMode ? editingTurn!.parent_turn_id : undefined;

    const narratorOpts = isEditMode && editingTurn
      ? inferNarratorTurnOptions(editingTurn, raw)
      : { isNarrator: false };

    if (narratorOpts.isNarrator) {
      onSendTurn({
        userMessage: raw,
        parentTurnId: targetParentId,
        diceMode: "disabled",
        narrativeMode: narratorOpts.narrativeMode,
        narratorDirective: narratorOpts.narratorDirective || raw,
        durationMinutes: narratorOpts.durationMinutes,
      });
    } else {
      onSendTurn({
        userMessage: raw,
        parentTurnId: targetParentId,
        diceMode,
        manualDiceOverride: diceMode === "forced" ? parsedDice : null,
        characterChoices: effectiveChoices,
      });
    }

    // Post-send cleanup: discard the stashed draft once the edit is saved
    stashedDraftRef.current = null;
    setEditingTurn(null);

    setInputText("");
    setMentionPickerOpen(false);
    setMentionQuery("");
    setMentionSelectedIndex(0);
    setDiceMode("auto");
    setDiceOverride("");
    setStagedChoices({});
    setActiveTray("none");
    setActivePopover("none");
    magicWand.reset();
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

    // Stash current composer draft if not already in edit mode
    if (!editingTurn && (inputText.trim() !== "" || Object.keys(stagedChoices).length > 0)) {
      stashedDraftRef.current = {
        inputText,
        diceMode,
        diceOverride,
        stagedChoices: JSON.parse(JSON.stringify(stagedChoices)),
      };
    }

    setEditingTurn(turn);
    setInputText(turn.user_message);

    const legacyForced = turn.pre_turn?.resolved_roll?.is_manual_override;
    const initialMode: DiceMode =
      turn.pre_turn?.dice_mode ?? (legacyForced ? "forced" : "auto");
    const initialVal =
      turn.pre_turn?.manual_dice_value ??
      (legacyForced ? turn.pre_turn?.resolved_roll?.d20_raw ?? null : null);
    setDiceMode(initialMode);
    setDiceOverride(initialVal != null ? String(initialVal) : "");

    // Hydrate choices: if active choices exist, auto-open drawer as requested
    if (
      turn.pre_turn?.character_choices &&
      Object.keys(turn.pre_turn.character_choices).length > 0
    ) {
      setStagedChoices(
        JSON.parse(JSON.stringify(turn.pre_turn.character_choices))
      );
      const firstCharId = Object.keys(turn.pre_turn.character_choices)[0];
      if (firstCharId) {
        setActiveChoiceCharId(firstCharId);
      }
      setActiveTray("choices");
    } else {
      setStagedChoices({});
      if (activeTray === "choices") {
        setActiveTray("none");
      }
    }

    magicWand.reset();
    setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 0);
  };

  const handleCancelEdit = () => {
    setEditingTurn(null);
    magicWand.reset();

    if (stashedDraftRef.current) {
      setInputText(stashedDraftRef.current.inputText);
      setDiceMode(stashedDraftRef.current.diceMode);
      setDiceOverride(stashedDraftRef.current.diceOverride);
      setStagedChoices(stashedDraftRef.current.stagedChoices);
      stashedDraftRef.current = null;
    } else {
      setInputText("");
      setDiceMode("auto");
      setDiceOverride("");
      setStagedChoices({});
      setActiveTray("none");
    }
  };
  handleCancelEditRef.current = handleCancelEdit;

  const handleDeleteLast = async () => {
    if (isBusy || isDeletingTurn || !onDeleteLastTurn) return;
    setIsDeletingTurn(true);
    try {
      handleCancelEdit();
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
          const isEditingThisTurn = isLastTurn && editingTurn?.id === turn.id;
          const cogOpen = openCognitionIds[turn.id] ?? (turn.depth_index === bundle.active_branch_turns.length - 1);
          const memOpen = openMemoryIds[turn.id] ?? false;
          const siblings = siblingsByParent[turn.parent_turn_id ?? "ROOT"] || [];

          return (
            <TurnCard
              key={turn.id}
              turn={turn}
              turnIdx={turnIdx}
              bundle={bundle}
              character={character}
              allCampaignCharacters={allCampaignCharacters}
              presentCharacterIds={presentCharacterIds}
              siblings={siblings}
              isBusy={isBusy}
              isDeletingTurn={isDeletingTurn}
              isEditingThisTurn={isEditingThisTurn}
              hasActiveEditingTurn={Boolean(editingTurn)}
              hasDeleteLastHandler={Boolean(onDeleteLastTurn)}
              cogOpen={cogOpen}
              memOpen={memOpen}
              phase4ProgressByTurn={phase4ProgressByTurn}
              onToggleCognition={toggleCognition}
              onToggleMemories={toggleMemories}
              onCheckoutTurn={onCheckoutTurn}
              onStartEdit={handleStartEdit}
              onCancelEdit={handleCancelEdit}
              onSwipeRegenerate={handleSwipeRegenerate}
              onDeleteLast={handleDeleteLast}
              onOpenAgentModal={setActiveAgentModal}
            />
          );
        })}

        {/* Active Streaming Turn Preview */}
        {liveStream && (
          <LiveStreamingTurnCard
            liveStream={liveStream}
            bundle={bundle}
            character={character}
            allCampaignCharacters={allCampaignCharacters}
            presentCharacterIds={presentCharacterIds}
            phase3Progress={phase3Progress}
          />
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
      <ChatComposer
        composerBarRef={composerBarRef}
        narratorBtnRef={narratorBtnRef}
        exitsBtnRef={exitsBtnRef}
        textareaRef={textareaRef}
        character={character}
        editingTurn={editingTurn}
        activeTray={activeTray}
        setActiveTray={setActiveTray}
        activePopover={activePopover}
        setActivePopover={setActivePopover}
        customDirectiveText={customDirectiveText}
        setCustomDirectiveText={setCustomDirectiveText}
        presentCharacters={presentCharacters}
        allCampaignCharacters={allCampaignCharacters}
        presentCharacterIds={presentCharacterIds}
        stagedChoices={stagedChoices}
        activeChoiceCharId={activeChoiceCharId}
        setActiveChoiceCharId={setActiveChoiceCharId}
        activeCharRecord={activeCharRecord}
        totalStagedOptionsCount={totalStagedOptionsCount}
        diceMode={diceMode}
        setDiceMode={setDiceMode}
        diceOverride={diceOverride}
        setDiceOverride={setDiceOverride}
        hasActiveGates={hasActiveGates}
        choicePreview={choicePreview}
        choiceSlashWarning={choiceSlashWarning}
        decomposedInput={decomposedInput}
        mentionPickerOpen={mentionPickerOpen}
        setMentionPickerOpen={setMentionPickerOpen}
        mentionQuery={mentionQuery}
        mentionSelectedIndex={mentionSelectedIndex}
        setMentionSelectedIndex={setMentionSelectedIndex}
        filteredMentionCharacters={filteredMentionCharacters}
        inputText={inputText}
        setInputText={setInputText}
        isBusy={isBusy}
        magicWand={magicWand}
        neighborLocations={bundle.neighbor_locations}
        handleSelectMention={handleSelectMention}
        handleRemoveMentionChip={handleRemoveMentionChip}
        checkAndTriggerMention={checkAndTriggerMention}
        handleInvokeNarrator={handleInvokeNarrator}
        handleQuickExit={handleQuickExit}
        handleSendCustomDirective={handleSendCustomDirective}
        handleClearAllChoices={handleClearAllChoices}
        handleClearCharChoices={handleClearCharChoices}
        handleSetDC={handleSetDC}
        handleAddOption={handleAddOption}
        handleUpdateOption={handleUpdateOption}
        handleRemoveOption={handleRemoveOption}
        handleCancelEdit={handleCancelEdit}
        handleSend={handleSend}
      />

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
