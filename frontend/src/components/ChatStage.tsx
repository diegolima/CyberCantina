import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Clock,
  GitBranch,
  MapPin,
  Menu,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import {
  ActiveSlashCommand,
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
import { ContextHealthPill } from "./chat/ContextHealthPill";
import { ContextHealthModal } from "./chat/ContextHealthModal";
import { getActiveTurnForTelemetry } from "./chat/contextHealthHelpers";
import {
  isChoiceSlashCommand,
  parseChoiceSlashCommand,
} from "../utils/choiceCommand";
import {
  applyPartyMentionSelection,
  detectPartyMentionContext,
  isPartySlashCommand,
  parsePartySlashCommand,
} from "../utils/partyCommand";
import {
  getActiveParties,
  getCoLocatedPlayerPartyNpcs,
  getPlayerParty,
  formatQuickExitMessage,
} from "../utils/partyHelpers";
import {
  detectSlashAutocompleteContext,
  findFirstEnabledIndex,
  formatActiveSlashCommand,
  getActiveSlashHint,
  getSlashCommandPrefix,
  resolveSlashCommandToken,
  tryPromoteSlashInput,
  validateSlashCommandInput,
  type SlashCommandAvailabilityContext,
  type SlashPickerItem,
} from "../utils/slashCommands";
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
import { getLatestBranchTurnId } from "./chat/arrivalHelpers";
import { LiveStreamingTurnCard } from "./chat/LiveStreamingTurnCard";
import { ChatComposer } from "./chat/ChatComposer";
import { GmTalkDrawer } from "./chat/GmTalkDrawer";
import { useGmTalk } from "../hooks/useGmTalk";

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
  scrollTargetTurn = null,
  focusComposerNonce = 0,
  onOpenStoryTimelines,
  showSidebarToggle = false,
  isSidebarOpen = false,
  onToggleSidebar,
  isInspectorOpen = true,
  onToggleInspector,
  hasInspectorAttention = false,
  onUpdateTurnBookmark,
  onSummarizeTurnForBookmark,
  onCampaignBundleChange,
  onOpenCodex,
}) => {
  const isBusy = isStreaming || isPhase4Running;
  const [inputText, setInputText] = useState("");
  const [activeSlash, setActiveSlash] = useState<ActiveSlashCommand | null>(null);
  const [slashPickerDismissed, setSlashPickerDismissed] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [slashCursorPos, setSlashCursorPos] = useState(0);
  const [submitSlashError, setSubmitSlashError] = useState<string | null>(null);
  const [diceMode, setDiceMode] = useState<DiceMode>("auto");
  const [diceOverride, setDiceOverride] = useState<string>("");
  const [openCognitionIds, setOpenCognitionIds] = useState<Record<string, boolean>>({});
  const [openMemoryIds, setOpenMemoryIds] = useState<Record<string, boolean>>({});
  const [arrivalManualOverrides, setArrivalManualOverrides] = useState<Record<string, boolean>>({});
  const [editingTurn, setEditingTurn] = useState<TurnNodeRecord | null>(null);
  const stashedDraftRef = useRef<{
    inputText: string;
    activeSlash: ActiveSlashCommand | null;
    diceMode: DiceMode;
    diceOverride: string;
    stagedChoices: Record<string, CharacterChoiceSet>;
  } | null>(null);
  const handleCancelEditRef = useRef<() => void>(() => {});
  const [isDeletingTurn, setIsDeletingTurn] = useState(false);
  const [customDirectiveText, setCustomDirectiveText] = useState("");
  const [activeAgentModal, setActiveAgentModal] = useState<ActiveAgentModalTarget | null>(null);
  const [isContextHealthOpen, setIsContextHealthOpen] = useState(false);
  const [highlightedTurnId, setHighlightedTurnId] = useState<string | null>(null);
  const turnFeedRef = useRef<HTMLDivElement | null>(null);
  const gmDrawerRef = useRef<HTMLElement | null>(null);

  const activeTelemetryTurn = useMemo(() => getActiveTurnForTelemetry(bundle), [bundle]);
  const activeTurnTelemetry = activeTelemetryTurn?.telemetry ?? null;

  // Consolidated Popover & Tray State
  const [activePopover, setActivePopover] = useState<ComposerPopoverId>("none");
  const [activeTray, setActiveTray] = useState<ComposerTrayId>("none");

  // DOM Refs for focus management and outside click handling
  const composerBarRef = useRef<HTMLFormElement | null>(null);
  const narratorBtnRef = useRef<HTMLButtonElement | null>(null);
  const exitsBtnRef = useRef<HTMLButtonElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Out-of-Character GM Talk ("Neuromancer") Slide-out & Composer Mode State
  const gmUnlockLore = Boolean(bundle.campaign.world_settings?.unlock_lore);
  const gmTalk = useGmTalk({
    campaignId: bundle.campaign.id,
    activeLeafTurnId: bundle.campaign.active_leaf_turn_id ?? null,
    unlockLore: gmUnlockLore,
    isCampaignStreaming: isBusy,
    textareaRef,
    onCampaignBundleChange,
  });

  // Clicking outside the GM slide-out and reused composer minimizes GM Talk
  useEffect(() => {
    if (!gmTalk.isOpen || gmTalk.isClosing) return;

    const handleDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (gmDrawerRef.current?.contains(target)) return;
      if (composerBarRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".modal-overlay")) return;
      gmTalk.minimize();
    };

    const handleDocKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (
        document.activeElement instanceof Element &&
        document.activeElement.closest(".modal-overlay")
      ) {
        return;
      }
      if (gmTalk.mentionPopoverOpen) {
        e.preventDefault();
        gmTalk.dismissMentionPopover();
        return;
      }
      e.preventDefault();
      gmTalk.minimize();
    };

    document.addEventListener("mousedown", handleDocMouseDown);
    document.addEventListener("keydown", handleDocKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleDocMouseDown);
      document.removeEventListener("keydown", handleDocKeyDown);
    };
  }, [
    gmTalk.dismissMentionPopover,
    gmTalk.isClosing,
    gmTalk.isOpen,
    gmTalk.mentionPopoverOpen,
    gmTalk.minimize,
  ]);

  // Director Choices State
  const [stagedChoices, setStagedChoices] = useState<Record<string, CharacterChoiceSet>>({});
  const [activeChoiceCharId, setActiveChoiceCharId] = useState<string>(character.id);
  const [choicePreview, setChoicePreview] = useState<ChoicePreviewResponse | null>(null);
  const [, setIsPreviewLoading] = useState(false);

  // Magic Wand Integration
  const lastBranchTurn =
    bundle.active_branch_turns[bundle.active_branch_turns.length - 1];
  const lastTurnId = getLatestBranchTurnId(bundle.active_branch_turns);

  // When a new turn is committed, collapse all past description cards (clearing manual overrides)
  useEffect(() => {
    setArrivalManualOverrides({});
  }, [lastTurnId]);

  // Scroll to a targeted turn card (from Story -> Branch Graph Zoom / Timeline Switch)
  useEffect(() => {
    if (!scrollTargetTurn) return;
    const targetId = scrollTargetTurn.turnId;
    const feed = turnFeedRef.current;
    if (!feed) return;
    const cards = Array.from(feed.querySelectorAll<HTMLElement>("[data-turn-id]"));
    const el = cards.find((node) => node.getAttribute("data-turn-id") === targetId);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (scrollTargetTurn.highlight !== false) {
      setHighlightedTurnId(targetId);
      const timer = window.setTimeout(() => {
        setHighlightedTurnId((curr) => (curr === targetId ? null : curr));
      }, 1700);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [scrollTargetTurn]);

  // Focus composer after branching from Story -> Branch Graph
  useEffect(() => {
    if (!focusComposerNonce) return;
    handleCancelEditRef.current();
    const timer = window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusComposerNonce]);

  const handleToggleArrivalCard = (cardKey: string, currentlyExpanded: boolean) => {
    setArrivalManualOverrides((prev) => ({
      ...prev,
      [cardKey]: !currentlyExpanded,
    }));
  };
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
    disabled: isBusy || Boolean(activeSlash),
    maxWords: 120,
  });

  const presentCharacters = useMemo(() => {
    const rawIds =
      bundle.present_character_ids !== undefined
        ? bundle.present_character_ids
        : [character.id];
    const uniqueIds = Array.from(new Set(rawIds));
    return uniqueIds.map((id) => {
      const rec = bundle.character_records?.[id];
      if (rec) return rec;
      if (id === character.id) return character;
      return { id, name: "Character" } as CharacterRecord;
    });
  }, [bundle.present_character_ids, bundle.character_records, character]);

  useEffect(() => {
    if (presentCharacters.length === 0) {
      if (activeChoiceCharId !== "") {
        setActiveChoiceCharId("");
      }
      if (activeTray === "choices") {
        setActiveTray("none");
      }
      return;
    }
    if (!presentCharacters.some((c) => c.id === activeChoiceCharId)) {
      setActiveChoiceCharId(presentCharacters[0].id);
    }
  }, [presentCharacters, activeChoiceCharId, activeTray]);

  const activeCharRecord = useMemo(() => {
    return (
      presentCharacters.find((c) => c.id === activeChoiceCharId) ||
      presentCharacters[0]
    );
  }, [presentCharacters, activeChoiceCharId]);

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
  const [mentionMode, setMentionMode] = useState<
    "whisper" | "party_invite" | "party_kick"
  >("whisper");
  const [mentionTriggerStart, setMentionTriggerStart] = useState<number | null>(
    null
  );
  const [mentionCandidates, setMentionCandidates] = useState<CharacterRecord[]>(
    []
  );

  const activeParties = getActiveParties(bundle);
  const playerParty = useMemo(
    () => getPlayerParty(activeParties),
    [activeParties]
  );
  const eligiblePartyInviteCount = useMemo(() => {
    const partyMemberIds = new Set(playerParty?.member_ids ?? []);
    return presentCharacterIds.filter((cid) => !partyMemberIds.has(cid)).length;
  }, [presentCharacterIds, playerParty]);

  const slashAvailabilityContext: SlashCommandAvailabilityContext = useMemo(
    () => ({
      presentCharacterCount: presentCharacters.length,
      eligiblePartyInviteCount,
      inPlayerParty: Boolean(playerParty),
      isEditingTurn: Boolean(editingTurn),
    }),
    [
      presentCharacters.length,
      eligiblePartyInviteCount,
      playerParty,
      editingTurn,
    ]
  );

  const effectiveRawInput = useMemo(
    () => formatActiveSlashCommand(activeSlash, inputText),
    [activeSlash, inputText]
  );

  const slashAutocomplete = useMemo(() => {
    if (mentionPickerOpen || slashPickerDismissed) return null;
    return detectSlashAutocompleteContext(
      inputText,
      slashCursorPos,
      activeSlash,
      slashAvailabilityContext
    );
  }, [
    mentionPickerOpen,
    slashPickerDismissed,
    inputText,
    slashCursorPos,
    activeSlash,
    slashAvailabilityContext,
  ]);

  const slashPickerItems = slashAutocomplete?.items ?? [];
  const slashPickerOpen = Boolean(
    slashAutocomplete && slashPickerItems.length > 0
  );
  const slashPickerStage = slashAutocomplete?.stage ?? "command";

  useEffect(() => {
    if (!slashPickerOpen) {
      setSlashSelectedIndex(0);
      return;
    }
    setSlashSelectedIndex(findFirstEnabledIndex(slashPickerItems));
  }, [
    slashPickerStage,
    slashAutocomplete?.query,
    slashPickerOpen,
    slashAvailabilityContext,
  ]);

  const slashHardError = useMemo(
    () =>
      submitSlashError ??
      validateSlashCommandInput(
        effectiveRawInput,
        activeSlash,
        slashAvailabilityContext
      ),
    [
      submitSlashError,
      effectiveRawInput,
      activeSlash,
      slashAvailabilityContext,
    ]
  );

  const slashSyntaxHint = useMemo(
    () => getActiveSlashHint(activeSlash),
    [activeSlash]
  );

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
        if (mentionPickerOpen) {
          setMentionPickerOpen(false);
          return;
        }
        if (slashPickerOpen) {
          setSlashPickerDismissed(true);
          return;
        }
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
  }, [
    activePopover,
    activeTray,
    editingTurn,
    mentionPickerOpen,
    slashPickerOpen,
  ]);

  const coLocatedPartyNpcs = useMemo(
    () => getCoLocatedPlayerPartyNpcs(activeParties, bundle.active_location.id),
    [activeParties, bundle.active_location.id]
  );

  const locationNameById = useMemo(
    () =>
      Object.fromEntries(
        bundle.visible_locations.map((loc) => [loc.id, loc.name])
      ),
    [bundle.visible_locations]
  );

  const charLocationMap = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(bundle.character_states ?? {}).map(([cid, st]) => [
          cid,
          st.current_location_id,
        ])
      ),
    [bundle.character_states]
  );

  const partyCommandState = useMemo(() => {
    if (!isPartySlashCommand(effectiveRawInput)) {
      return { action: null, error: null };
    }
    return parsePartySlashCommand(effectiveRawInput, {
      allCharacters: allCampaignCharacters,
      presentCharacterIds,
      activeParties,
      locationNameById,
      charLocations: charLocationMap,
    });
  }, [
    effectiveRawInput,
    allCampaignCharacters,
    presentCharacterIds,
    activeParties,
    locationNameById,
    charLocationMap,
  ]);

  const mentionPool =
    mentionMode === "whisper" ? allCampaignCharacters : mentionCandidates;

  const filteredMentionCharacters = useMemo(() => {
    const clean = mentionQuery.trim().toLowerCase();
    if (!clean) return mentionPool;
    return mentionPool.filter(
      (c) =>
        c.name.toLowerCase().includes(clean) ||
        (c.tagline && c.tagline.toLowerCase().includes(clean))
    );
  }, [mentionPool, mentionQuery]);

  useEffect(() => {
    setMentionSelectedIndex(0);
  }, [mentionQuery, mentionMode]);

  const decomposedInput = useMemo(() => {
    return decomposeClientUserMessage(
      activeSlash ? "" : inputText,
      allCampaignCharacters,
      presentCharacterIds
    );
  }, [activeSlash, inputText, allCampaignCharacters, presentCharacterIds]);

  const focusTextareaAt = (pos: number) => {
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  const checkAndTriggerMention = (
    newText: string,
    cursorOffset?: number,
    slashOverride: ActiveSlashCommand | null = activeSlash
  ) => {
    const textarea = textareaRef.current;
    const cursorPos = cursorOffset ?? textarea?.selectionStart ?? newText.length;

    if (slashOverride === null || slashOverride.command === "party") {
      const prefix = getSlashCommandPrefix(slashOverride);
      const partyCtx = detectPartyMentionContext(
        prefix + newText,
        prefix.length + cursorPos,
        {
          allCharacters: allCampaignCharacters,
          presentCharacterIds,
          activeParties,
        }
      );
      if (partyCtx) {
        setMentionMode(partyCtx.mode);
        setMentionTriggerStart(
          Math.max(0, partyCtx.triggerStart - prefix.length)
        );
        setMentionCandidates(partyCtx.candidates);
        setMentionQuery(partyCtx.query);
        setMentionPickerOpen(partyCtx.candidates.length > 0);
        return;
      }
    }

    if (slashOverride !== null) {
      setMentionPickerOpen(false);
      return;
    }

    const textBeforeCursor = newText.slice(0, cursorPos);
    const lastNewlineIdx = textBeforeCursor.lastIndexOf("\n");
    const lineStartIdx = lastNewlineIdx === -1 ? 0 : lastNewlineIdx + 1;
    const lineBeforeCursor = textBeforeCursor.slice(lineStartIdx);

    if (lineBeforeCursor.startsWith("@") && !lineBeforeCursor.includes(":")) {
      setMentionMode("whisper");
      setMentionTriggerStart(lineStartIdx);
      setMentionCandidates(allCampaignCharacters);
      setMentionQuery(lineBeforeCursor.slice(1));
      setMentionPickerOpen(true);
    } else {
      setMentionPickerOpen(false);
    }
  };

  const handleComposerInputChange = (nextVal: string, cursorPos: number) => {
    setSubmitSlashError(null);
    setSlashPickerDismissed(false);

    const promoted = tryPromoteSlashInput(
      nextVal,
      cursorPos,
      activeSlash,
      slashAvailabilityContext
    );
    if (promoted) {
      setActiveSlash(promoted.activeSlash);
      setInputText(promoted.nextText);
      setSlashCursorPos(promoted.nextCursorPos);
      checkAndTriggerMention(
        promoted.nextText,
        promoted.nextCursorPos,
        promoted.activeSlash
      );
      focusTextareaAt(promoted.nextCursorPos);
      return;
    }

    setInputText(nextVal);
    setSlashCursorPos(cursorPos);
    checkAndTriggerMention(nextVal, cursorPos, activeSlash);
  };

  const handleComposerCursorChange = (cursorPos: number) => {
    setSlashCursorPos(cursorPos);
    checkAndTriggerMention(inputText, cursorPos, activeSlash);
  };

  const handleSelectSlashItem = (item: SlashPickerItem) => {
    if (!item.available) return;
    const start = slashAutocomplete?.tokenStart ?? 0;
    const end = slashAutocomplete?.tokenEnd ?? inputText.length;
    const before = inputText.slice(0, start);
    const after = inputText.slice(end).replace(/^[ \t]+/, "");
    const nextText = `${before}${after}`;
    const nextCursorPos = before.length;
    const nextSlash: ActiveSlashCommand =
      item.stage === "subcommand"
        ? { command: "party", subcommand: item.subcommandId }
        : { command: item.commandId, subcommand: null };

    setActiveSlash(nextSlash);
    setInputText(nextText);
    setSlashCursorPos(nextCursorPos);
    setSubmitSlashError(null);
    setSlashPickerDismissed(false);
    checkAndTriggerMention(nextText, nextCursorPos, nextSlash);
    focusTextareaAt(nextCursorPos);
  };

  const handleBackspaceSlashPill = () => {
    if (!activeSlash) return;
    setSubmitSlashError(null);
    setSlashPickerDismissed(false);
    if (activeSlash.subcommand !== null) {
      const nextSlash: ActiveSlashCommand = {
        command: activeSlash.command,
        subcommand: null,
      };
      setActiveSlash(nextSlash);
      setSlashCursorPos(0);
      checkAndTriggerMention(inputText, 0, nextSlash);
      focusTextareaAt(0);
      return;
    }
    setActiveSlash(null);
    setSlashCursorPos(0);
    checkAndTriggerMention(inputText, 0, null);
    focusTextareaAt(0);
  };

  const handleClearActiveSlash = () => {
    setActiveSlash(null);
    setSubmitSlashError(null);
    setSlashPickerDismissed(false);
    setSlashCursorPos(0);
    checkAndTriggerMention(inputText, 0, null);
    focusTextareaAt(0);
  };

  const handleInsertSlashFromHelp = (cmd: ActiveSlashCommand) => {
    setActiveTray("none");
    setActivePopover("none");
    setSubmitSlashError(null);
    setSlashPickerDismissed(false);
    setActiveSlash(cmd);
    setSlashCursorPos(0);
    checkAndTriggerMention(inputText, 0, cmd);
    focusTextareaAt(0);
  };

  const handleSelectMention = (char: CharacterRecord) => {
    const textarea = textareaRef.current;
    const cursorPos = textarea?.selectionStart ?? inputText.length;

    if (mentionMode !== "whisper" && mentionTriggerStart !== null) {
      const { nextText, nextCursorPos } = applyPartyMentionSelection(
        inputText,
        cursorPos,
        mentionTriggerStart,
        char.name
      );
      setInputText(nextText);
      setSlashCursorPos(nextCursorPos);
      setMentionPickerOpen(false);
      setMentionQuery("");
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(nextCursorPos, nextCursorPos);
        }
      }, 10);
      return;
    }

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
    if (!isChoiceSlashCommand(effectiveRawInput)) return null;
    const body = effectiveRawInput.trim().replace(/^\/choices?\s*/i, "").trim();
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
  }, [effectiveRawInput]);

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
    setActiveSlash(null);
    setSlashCursorPos(0);
    setSubmitSlashError(null);
    setSlashPickerDismissed(false);
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
    setActiveSlash(null);
    setInputText("");
    setSlashCursorPos(0);
    setSubmitSlashError(null);
    setSlashPickerDismissed(false);
    setStagedChoices({});
    magicWand.reset();

    const forcedVal =
      diceMode === "forced" && diceOverride.trim() !== ""
        ? parseInt(diceOverride.trim(), 10)
        : null;

    onSendTurn({
      userMessage: formatQuickExitMessage(nb, coLocatedPartyNpcs.length > 0),
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
    const raw = effectiveRawInput.trim();
    if ((!raw && totalStagedOptionsCount === 0) || isBusy) return;

    const submitErr = validateSlashCommandInput(
      effectiveRawInput,
      activeSlash,
      slashAvailabilityContext,
      { isSubmitting: true }
    );
    if (submitErr) {
      setSubmitSlashError(submitErr);
      return;
    }

    if (partyCommandState.error) return;

    // Check for slash command shortcuts (excluding /party which submits as a full turn)
    if (raw.startsWith("/") && !isPartySlashCommand(raw)) {
      const parts = raw.slice(1).split(/\s+/);
      const cmdSpec = resolveSlashCommandToken(parts[0] || "");
      const arg = parts.slice(1).join(" ").trim();

      if (cmdSpec?.id === "gm") {
        setActiveSlash(null);
        setInputText("");
        setSlashCursorPos(0);
        setSubmitSlashError(null);
        setSlashPickerDismissed(false);
        setMentionPickerOpen(false);
        setActivePopover("none");
        magicWand.reset();
        gmTalk.open(arg || null);
        return;
      }

      if (cmdSpec?.id === "help") {
        setActiveSlash(null);
        setInputText("");
        setSlashCursorPos(0);
        setSubmitSlashError(null);
        setSlashPickerDismissed(false);
        setMentionPickerOpen(false);
        setActivePopover("none");
        setActiveTray("slash_help");
        magicWand.reset();
        return;
      }

      if (cmdSpec?.id === "choice") {
        const parsed = parseChoiceSlashCommand(raw, presentCharacters);
        if (parsed && parsed.choiceSet.options.length > 0) {
          const targetId = parsed.choiceSet.character_id;
          setStagedChoices((prev) => ({
            ...prev,
            [targetId]: parsed.choiceSet,
          }));
          setActiveChoiceCharId(targetId);
          setActiveTray("choices");
          setActiveSlash(null);
          setInputText("");
          setSlashCursorPos(0);
          setSubmitSlashError(null);
          setSlashPickerDismissed(false);
          magicWand.reset();
          return;
        } else if (parsed && parsed.matchedCharacter) {
          setActiveChoiceCharId(parsed.matchedCharacter.id);
          setActiveTray("choices");
          setActiveSlash(null);
          setInputText("");
          setSlashCursorPos(0);
          setSubmitSlashError(null);
          setSlashPickerDismissed(false);
          magicWand.reset();
          return;
        }
      }

      if (cmdSpec?.id === "look") {
        setActiveSlash(null);
        setInputText("");
        setSlashCursorPos(0);
        setSubmitSlashError(null);
        setSlashPickerDismissed(false);
        setDiceMode("auto");
        setDiceOverride("");
        magicWand.reset();
        handleInvokeNarrator("describe");
        return;
      }
      if (cmdSpec?.id === "wait") {
        setActiveSlash(null);
        setInputText("");
        setSlashCursorPos(0);
        setSubmitSlashError(null);
        setSlashPickerDismissed(false);
        setDiceMode("auto");
        setDiceOverride("");
        magicWand.reset();
        let dur: number | undefined;
        if (arg.endsWith("m") || arg.endsWith("min") || arg.endsWith("minutes")) {
          dur = parseInt(arg, 10);
        } else if (arg.endsWith("h") || arg.endsWith("hr") || arg.endsWith("hours")) {
          dur = parseInt(arg, 10) * 60;
        }
        handleInvokeNarrator(
          "advance",
          arg || "a few moments",
          isNaN(dur as number) ? undefined : dur
        );
        return;
      }
      if (cmdSpec?.id === "event") {
        setActiveSlash(null);
        setInputText("");
        setSlashCursorPos(0);
        setSubmitSlashError(null);
        setSlashPickerDismissed(false);
        setDiceMode("auto");
        setDiceOverride("");
        magicWand.reset();
        handleInvokeNarrator("complication", arg || undefined);
        return;
      }
      if (cmdSpec?.id === "narrate") {
        setActiveSlash(null);
        setInputText("");
        setSlashCursorPos(0);
        setSubmitSlashError(null);
        setSlashPickerDismissed(false);
        setDiceMode("auto");
        setDiceOverride("");
        magicWand.reset();
        if (arg) {
          const targetParentId = editingTurn
            ? editingTurn.parent_turn_id
            : undefined;
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
        partyAction:
          partyCommandState.action ??
          (isEditMode ? editingTurn?.pre_turn?.party_action ?? null : null),
      });
    }

    // Post-send cleanup: discard the stashed draft once the edit is saved
    stashedDraftRef.current = null;
    setEditingTurn(null);

    setActiveSlash(null);
    setInputText("");
    setSlashCursorPos(0);
    setSubmitSlashError(null);
    setSlashPickerDismissed(false);
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
      partyAction: turn.pre_turn?.party_action ?? null,
    });
  };

  const handleStartEdit = (turn: TurnNodeRecord) => {
    if (isBusy || isDeletingTurn || !turn.parent_turn_id) return;

    // Stash current composer draft if not already in edit mode
    if (
      !editingTurn &&
      (inputText.trim() !== "" ||
        activeSlash !== null ||
        Object.keys(stagedChoices).length > 0)
    ) {
      stashedDraftRef.current = {
        inputText,
        activeSlash,
        diceMode,
        diceOverride,
        stagedChoices: JSON.parse(JSON.stringify(stagedChoices)),
      };
    }

    setEditingTurn(turn);
    setActiveSlash(null);
    setInputText(turn.user_message);
    setSlashCursorPos(turn.user_message.length);
    setSubmitSlashError(null);
    setSlashPickerDismissed(false);

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
    setSubmitSlashError(null);
    setSlashPickerDismissed(false);
    magicWand.reset();

    if (stashedDraftRef.current) {
      setActiveSlash(stashedDraftRef.current.activeSlash);
      setInputText(stashedDraftRef.current.inputText);
      setSlashCursorPos(stashedDraftRef.current.inputText.length);
      setDiceMode(stashedDraftRef.current.diceMode);
      setDiceOverride(stashedDraftRef.current.diceOverride);
      setStagedChoices(stashedDraftRef.current.stagedChoices);
      stashedDraftRef.current = null;
    } else {
      setActiveSlash(null);
      setInputText("");
      setSlashCursorPos(0);
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

  const handleBranchFromTurn = async (turn: TurnNodeRecord) => {
    if (isBusy || isDeletingTurn) return;
    if (editingTurn) handleCancelEdit();
    await onCheckoutTurn(turn.id);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 0);
  };

  // Count sibling branches & children per parent_turn_id
  const siblingsByParent: Record<string, TurnNodeRecord[]> = {};
  const childCountByParent: Record<string, number> = {};
  for (const node of bundle.all_turn_nodes) {
    const key = node.parent_turn_id ?? "ROOT";
    if (!siblingsByParent[key]) siblingsByParent[key] = [];
    siblingsByParent[key].push(node);
    if (node.parent_turn_id) {
      childCountByParent[node.parent_turn_id] =
        (childCountByParent[node.parent_turn_id] ?? 0) + 1;
    }
  }
  const activeLeafContinuationCount = lastBranchTurn
    ? childCountByParent[lastBranchTurn.id] ?? 0
    : 0;

  return (
    <main className="chat-stage">
      <header className="stage-header">
        <div className="stage-header-left">
          {showSidebarToggle && onToggleSidebar && (
            <button
              type="button"
              className={`btn stage-panel-toggle ${isSidebarOpen ? "active" : ""}`}
              onClick={onToggleSidebar}
              aria-expanded={isSidebarOpen}
              aria-controls="app-sidebar-aside"
              aria-label={isSidebarOpen ? "Close navigation sidebar" : "Open navigation sidebar"}
              title="Toggle navigation sidebar"
            >
              <Menu size={16} />
            </button>
          )}
          <div className="stage-header-main">
            <div className="stage-title-row">
              <div className="stage-campaign-title" title={bundle.campaign.name}>
                {bundle.campaign.name}
              </div>
              <ContextHealthPill
                telemetry={activeTurnTelemetry}
                onClick={() => setIsContextHealthOpen(true)}
              />
            </div>
            <div className="stage-actor-line">
              {presentCharacters.length === 0 ? (
                <>
                  <strong style={{ color: "var(--accent-cyan)" }}>
                    Alone in {bundle.active_location.name}
                  </strong>
                  <span className="stage-actor-tagline">
                    {" "}
                    — No characters present here
                  </span>
                </>
              ) : (
                <>
                  Actor: <strong style={{ color: "var(--accent-amber)" }}>{character.name}</strong>
                  {character.tagline && (
                    <span className="stage-actor-tagline"> — {character.tagline}</span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        <div className="stage-header-actions">
          <div className="stage-header-badges">
            <span className="badge">
              <MapPin size={13} color="var(--accent-cyan)" />
              {bundle.active_location.name}
            </span>
            <span className="badge">
              <Clock size={13} color="var(--accent-amber)" />
              {bundle.current_world_snapshot.world_timestamp}
            </span>
          </div>
          {onToggleInspector && (
            <button
              type="button"
              className={`btn stage-panel-toggle stage-inspector-toggle ${
                isInspectorOpen ? "active" : ""
              }`}
              onClick={onToggleInspector}
              aria-expanded={isInspectorOpen}
              aria-controls="live-inspector-aside"
              aria-label={
                isInspectorOpen
                  ? "Hide World & Mind Inspector"
                  : "Show World & Mind Inspector"
              }
              title={
                isInspectorOpen
                  ? "Hide World & Mind Inspector"
                  : "Show World & Mind Inspector"
              }
            >
              {isInspectorOpen ? (
                <PanelRightClose size={16} />
              ) : (
                <PanelRightOpen size={16} />
              )}
              {hasInspectorAttention && !isInspectorOpen && (
                <span
                  className="stage-attention-dot"
                  title="Pending location override staged"
                />
              )}
            </button>
          )}
        </div>
      </header>

      <div className="chat-stage-feed-region">
        <div className="turn-feed" ref={turnFeedRef}>
        {bundle.active_branch_turns.map((turn, turnIdx) => {
          const isRoot = turn.depth_index === 0;
          const isLastTurn =
            !isRoot && turnIdx === bundle.active_branch_turns.length - 1;
          const isEditingThisTurn = isLastTurn && editingTurn?.id === turn.id;
          const cogOpen = openCognitionIds[turn.id] ?? (turn.depth_index === bundle.active_branch_turns.length - 1);
          const memOpen = openMemoryIds[turn.id] ?? false;
          const siblings = siblingsByParent[turn.parent_turn_id ?? "ROOT"] || [];
          const hasDescendants = (childCountByParent[turn.id] ?? 0) > 0;

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
              hasDescendants={hasDescendants}
              isHighlighted={highlightedTurnId === turn.id}
              cogOpen={cogOpen}
              memOpen={memOpen}
              phase4ProgressByTurn={phase4ProgressByTurn}
              lastTurnId={lastTurnId}
              arrivalManualOverrides={arrivalManualOverrides}
              onToggleArrivalCard={handleToggleArrivalCard}
              onToggleCognition={toggleCognition}
              onToggleMemories={toggleMemories}
              onCheckoutTurn={onCheckoutTurn}
              onBranchFromTurn={handleBranchFromTurn}
              onStartEdit={handleStartEdit}
              onCancelEdit={handleCancelEdit}
              onSwipeRegenerate={handleSwipeRegenerate}
              onDeleteLast={handleDeleteLast}
              onOpenAgentModal={setActiveAgentModal}
              onUpdateTurnBookmark={onUpdateTurnBookmark}
              onSummarizeTurnForBookmark={onSummarizeTurnForBookmark}
            />
          );
        })}

        {/* In-Stage Rewind Continuity Banner when active leaf has preserved future continuations */}
        {!liveStream && lastBranchTurn && activeLeafContinuationCount > 0 && (
          <div className="branch-rewind-banner" role="status">
            <div className="branch-rewind-banner-text">
              <GitBranch size={14} color="var(--accent-violet)" />
              <span>
                <strong>Branched at Turn #{lastBranchTurn.depth_index}</strong> ·{" "}
                {activeLeafContinuationCount === 1
                  ? "Existing continuation preserved"
                  : `${activeLeafContinuationCount} existing continuations preserved`}{" "}
                — prompt below to start a new branch.
              </span>
            </div>
            {onOpenStoryTimelines && (
              <button
                type="button"
                className="btn btn-ghost branch-rewind-banner-btn"
                onClick={onOpenStoryTimelines}
              >
                <GitBranch size={12} />
                <span>Open Branch Graph</span>
              </button>
            )}
          </div>
        )}

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

        {/* Out-of-Character GM Talk Slide-Out Drawer ("Neuromancer") */}
        {gmTalk.isOpen && (
          <GmTalkDrawer
            drawerRef={gmDrawerRef}
            campaignTitle={bundle.campaign.name}
            worldName={bundle.campaign.world_name || "Active World"}
            unlockLore={gmUnlockLore}
            isClosing={gmTalk.isClosing}
            isExpanded={gmTalk.isExpanded}
            isCampaignStreaming={isBusy}
            messages={gmTalk.messages}
            isLoading={gmTalk.isLoading}
            isStreaming={gmTalk.isStreaming}
            streamingText={gmTalk.streamingText}
            streamingSources={gmTalk.streamingSources}
            error={gmTalk.error}
            clearConfirm={gmTalk.clearConfirm}
            isClearing={gmTalk.isClearing}
            copiedId={gmTalk.copiedId}
            expandedSources={gmTalk.expandedSources}
            modelMeta={gmTalk.modelMeta}
            draftingMessageId={gmTalk.draftingMessageId}
            savingProposalId={gmTalk.savingProposalId}
            proposalErrors={gmTalk.proposalErrors}
            onInsertAtTrigger={gmTalk.insertAtTrigger}
            onClearChat={() => {
              void gmTalk.handleClearChat();
            }}
            onCopyMessage={gmTalk.copyMessage}
            onToggleSources={gmTalk.toggleSources}
            onDraftCodexEntry={(msgId) => {
              void gmTalk.draftCodexEntry(msgId);
            }}
            onConfirmCodexProposal={(msgId, propId, draft, replaceId) => {
              void gmTalk.confirmCodexProposal(msgId, propId, draft, replaceId);
            }}
            onCancelCodexProposal={(msgId, propId) => {
              void gmTalk.cancelCodexProposal(msgId, propId);
            }}
            onOpenCodex={onOpenCodex}
            onDismissError={gmTalk.dismissError}
            onToggleExpanded={gmTalk.toggleExpanded}
            onMinimize={gmTalk.minimize}
          />
        )}
      </div>

      {/* Quick Action Bar + Composer (Shared between Story Mode and GM Talk Mode) */}
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
        partySlashWarning={partyCommandState.error}
        decomposedInput={decomposedInput}
        mentionPickerOpen={mentionPickerOpen}
        setMentionPickerOpen={setMentionPickerOpen}
        mentionQuery={mentionQuery}
        mentionMode={mentionMode}
        mentionCharacters={mentionPool}
        mentionSelectedIndex={mentionSelectedIndex}
        setMentionSelectedIndex={setMentionSelectedIndex}
        filteredMentionCharacters={filteredMentionCharacters}
        activeSlash={activeSlash}
        slashPickerOpen={slashPickerOpen}
        slashPickerStage={slashPickerStage}
        slashPickerItems={slashPickerItems}
        slashSelectedIndex={slashSelectedIndex}
        setSlashSelectedIndex={setSlashSelectedIndex}
        slashHardError={slashHardError}
        slashSyntaxHint={slashSyntaxHint}
        slashAvailabilityContext={slashAvailabilityContext}
        onSelectSlashItem={handleSelectSlashItem}
        onDismissSlashPicker={() => setSlashPickerDismissed(true)}
        onClearActiveSlash={handleClearActiveSlash}
        onBackspaceSlashPill={handleBackspaceSlashPill}
        onInsertSlashFromHelp={handleInsertSlashFromHelp}
        onComposerInputChange={handleComposerInputChange}
        onComposerCursorChange={handleComposerCursorChange}
        inputText={inputText}
        setInputText={setInputText}
        isBusy={isBusy}
        magicWand={magicWand}
        activeLocationName={bundle.active_location.name}
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
        onOpenGmTalk={() => gmTalk.open()}
        gmMode={{
          isActive: gmTalk.isModeActive,
          isStreaming: gmTalk.isStreaming,
          isCampaignStreaming: isBusy,
          draftText: gmTalk.draftText,
          pinnedMentions: gmTalk.pinnedMentions,
          mentionTrigger: gmTalk.mentionTrigger,
          mentionPopoverOpen: gmTalk.mentionPopoverOpen,
          mentionItems: gmTalk.mentionItems,
          mentionLoading: gmTalk.mentionLoading,
          mentionSelectedIndex: gmTalk.mentionSelectedIndex,
          onHoverMentionIndex: gmTalk.setMentionSelectedIndex,
          onDraftChange: gmTalk.handleDraftChange,
          onDraftCursorChange: gmTalk.handleDraftCursorChange,
          onSelectMentionCategory: gmTalk.handleSelectCategory,
          onSelectMentionCandidate: gmTalk.handleSelectCandidate,
          onPopCategoryToBrowse: gmTalk.handlePopCategoryToBrowse,
          onDismissMentionPopover: gmTalk.dismissMentionPopover,
          onRemovePinnedMention: gmTalk.handleRemovePinnedMention,
          onInsertAtTrigger: gmTalk.insertAtTrigger,
          onSend: () => {
            void gmTalk.sendMessage();
          },
          onStop: gmTalk.stopStreaming,
          onToggleOpen: gmTalk.toggle,
          onMinimize: gmTalk.minimize,
        }}
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

      {/* Turn Context Telemetry & Context Health Modal */}
      <ContextHealthModal
        isOpen={isContextHealthOpen}
        onClose={() => setIsContextHealthOpen(false)}
        telemetry={activeTurnTelemetry}
        turnDepth={activeTelemetryTurn?.depth_index ?? null}
        onOpenSettings={onOpenSettings}
      />
    </main>
  );
};
