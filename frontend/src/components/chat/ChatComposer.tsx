import React from "react";
import {
  AlertTriangle,
  ChevronDown,
  Clock,
  Compass,
  Dices,
  Edit3,
  Eye,
  ListChecks,
  Lock,
  MessageSquare,
  Radio,
  RefreshCw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import {
  ActiveSlashCommand,
  CharacterChoiceOption,
  CharacterChoiceSet,
  CharacterRecord,
  ChoicePreviewResponse,
  ComposerPopoverId,
  ComposerTrayId,
  DecomposedUserMessage,
  DiceMode,
  NarrativeMode,
  NeighborLocationView,
  TurnNodeRecord,
} from "../../types";
import {
  findNextEnabledIndex,
  getSlashCommandSpec,
  isExactZeroArgCommandText,
  type ActiveSlashHint,
  type SlashCommandAvailabilityContext,
  type SlashPickerItem,
} from "../../utils/slashCommands";
import { useMagicWand } from "../../hooks/useMagicWand";
import { MagicWandButton } from "../MagicWandButton";
import { CharacterMentionPicker } from "../CharacterMentionPicker";
import { DirectorChoicesDrawer } from "./DirectorChoicesDrawer";
import { SlashCommandIcon, SlashCommandPicker } from "./SlashCommandPicker";
import { SlashHelpTray } from "./SlashHelpTray";

export interface ChatComposerProps {
  composerBarRef: React.RefObject<HTMLFormElement>;
  narratorBtnRef: React.RefObject<HTMLButtonElement>;
  exitsBtnRef: React.RefObject<HTMLButtonElement>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  character: CharacterRecord;
  editingTurn: TurnNodeRecord | null;
  activeTray: ComposerTrayId;
  setActiveTray: React.Dispatch<React.SetStateAction<ComposerTrayId>>;
  activePopover: ComposerPopoverId;
  setActivePopover: React.Dispatch<React.SetStateAction<ComposerPopoverId>>;
  customDirectiveText: string;
  setCustomDirectiveText: React.Dispatch<React.SetStateAction<string>>;
  presentCharacters: CharacterRecord[];
  allCampaignCharacters: CharacterRecord[];
  presentCharacterIds: string[];
  stagedChoices: Record<string, CharacterChoiceSet>;
  activeChoiceCharId: string;
  setActiveChoiceCharId: React.Dispatch<React.SetStateAction<string>>;
  activeCharRecord: CharacterRecord | undefined;
  totalStagedOptionsCount: number;
  diceMode: DiceMode;
  setDiceMode: React.Dispatch<React.SetStateAction<DiceMode>>;
  diceOverride: string;
  setDiceOverride: React.Dispatch<React.SetStateAction<string>>;
  hasActiveGates: boolean;
  choicePreview: ChoicePreviewResponse | null;
  choiceSlashWarning: string | null;
  partySlashWarning?: string | null;
  decomposedInput: DecomposedUserMessage;
  mentionPickerOpen: boolean;
  setMentionPickerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  mentionQuery: string;
  mentionMode?: "whisper" | "party_invite" | "party_kick";
  mentionCharacters?: CharacterRecord[];
  mentionSelectedIndex: number;
  setMentionSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  filteredMentionCharacters: CharacterRecord[];
  activeSlash?: ActiveSlashCommand | null;
  slashPickerOpen?: boolean;
  slashPickerStage?: "command" | "subcommand";
  slashPickerItems?: SlashPickerItem[];
  slashSelectedIndex?: number;
  setSlashSelectedIndex?: React.Dispatch<React.SetStateAction<number>>;
  slashHardError?: string | null;
  slashSyntaxHint?: ActiveSlashHint | null;
  slashAvailabilityContext?: SlashCommandAvailabilityContext;
  onSelectSlashItem?: (item: SlashPickerItem) => void;
  onDismissSlashPicker?: () => void;
  onClearActiveSlash?: () => void;
  onBackspaceSlashPill?: () => void;
  onInsertSlashFromHelp?: (cmd: ActiveSlashCommand) => void;
  onComposerInputChange?: (value: string, cursorPos: number) => void;
  onComposerCursorChange?: (cursorPos: number) => void;
  inputText: string;
  setInputText: React.Dispatch<React.SetStateAction<string>>;
  isBusy: boolean;
  magicWand: ReturnType<typeof useMagicWand>;
  activeLocationName?: string;
  neighborLocations: NeighborLocationView[];
  handleSelectMention: (char: CharacterRecord) => void;
  handleRemoveMentionChip: (charName: string) => void;
  checkAndTriggerMention: (newText: string, cursorOffset?: number) => void;
  handleInvokeNarrator: (mode: NarrativeMode, customText?: string, elapsedMinutes?: number) => void;
  handleQuickExit: (nb: NeighborLocationView) => void;
  handleSendCustomDirective: () => void;
  handleClearAllChoices: () => void;
  handleClearCharChoices: (charId: string) => void;
  handleSetDC: (charId: string, dc: number) => void;
  handleAddOption: (charId: string) => void;
  handleUpdateOption: (charId: string, optId: string, patch: Partial<CharacterChoiceOption>) => void;
  handleRemoveOption: (charId: string, optId: string) => void;
  handleCancelEdit: () => void;
  handleSend: (e: React.FormEvent) => void;
}

export const ChatComposer: React.FC<ChatComposerProps> = ({
  composerBarRef,
  narratorBtnRef,
  exitsBtnRef,
  textareaRef,
  character,
  editingTurn,
  activeTray,
  setActiveTray,
  activePopover,
  setActivePopover,
  customDirectiveText,
  setCustomDirectiveText,
  presentCharacters,
  allCampaignCharacters,
  presentCharacterIds,
  stagedChoices,
  activeChoiceCharId,
  setActiveChoiceCharId,
  activeCharRecord,
  totalStagedOptionsCount,
  diceMode,
  setDiceMode,
  diceOverride,
  setDiceOverride,
  hasActiveGates,
  choicePreview,
  choiceSlashWarning,
  partySlashWarning = null,
  decomposedInput,
  mentionPickerOpen,
  setMentionPickerOpen,
  mentionQuery,
  mentionMode = "whisper",
  mentionCharacters,
  mentionSelectedIndex,
  setMentionSelectedIndex,
  filteredMentionCharacters,
  activeSlash = null,
  slashPickerOpen = false,
  slashPickerStage = "command",
  slashPickerItems = [],
  slashSelectedIndex = 0,
  setSlashSelectedIndex,
  slashHardError = null,
  slashSyntaxHint = null,
  slashAvailabilityContext,
  onSelectSlashItem,
  onDismissSlashPicker,
  onClearActiveSlash,
  onBackspaceSlashPill,
  onInsertSlashFromHelp,
  onComposerInputChange,
  onComposerCursorChange,
  inputText,
  setInputText,
  isBusy,
  magicWand,
  activeLocationName,
  neighborLocations,
  handleSelectMention,
  handleRemoveMentionChip,
  checkAndTriggerMention,
  handleInvokeNarrator,
  handleQuickExit,
  handleSendCustomDirective,
  handleClearAllChoices,
  handleClearCharChoices,
  handleSetDC,
  handleAddOption,
  handleUpdateOption,
  handleRemoveOption,
  handleCancelEdit,
  handleSend,
}) => {
  const activeSlashSpec = activeSlash
    ? getSlashCommandSpec(activeSlash.command)
    : null;
  const effectiveSlashAvailability: SlashCommandAvailabilityContext =
    slashAvailabilityContext ?? {
      presentCharacterCount: presentCharacters.length,
      eligiblePartyInviteCount: presentCharacters.length,
      inPlayerParty: false,
      isEditingTurn: Boolean(editingTurn),
    };

  return (
      <form ref={composerBarRef} className="composer-bar" onSubmit={handleSend}>
        {/* Active Edit Mode Banner */}
        {editingTurn && (
          <div className="composer-editing-banner">
            <Edit3 size={13} color="var(--accent-amber)" />
            <span>
              Editing <strong>Last Turn</strong> — changes will generate a new swipe branch
            </span>
          </div>
        )}

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
          <DirectorChoicesDrawer
            presentCharacters={presentCharacters}
            stagedChoices={stagedChoices}
            activeChoiceCharId={activeChoiceCharId}
            setActiveChoiceCharId={setActiveChoiceCharId}
            activeCharRecord={activeCharRecord}
            totalStagedOptionsCount={totalStagedOptionsCount}
            diceMode={diceMode}
            choicePreview={choicePreview}
            onClearAll={handleClearAllChoices}
            onClearChar={handleClearCharChoices}
            onSetDC={handleSetDC}
            onAddOption={handleAddOption}
            onUpdateOption={handleUpdateOption}
            onRemoveOption={handleRemoveOption}
            onClose={() => setActiveTray("none")}
          />
        )}

        {/* Slash Commands /help Reference Tray */}
        {activeTray === "slash_help" && (
          <SlashHelpTray
            availabilityContext={effectiveSlashAvailability}
            onInsertCommand={(cmd) => onInsertSlashFromHelp?.(cmd)}
            onClose={() => setActiveTray("none")}
          />
        )}

        {/* Unified Modern Composer Card */}
        <div className="composer-card">
          {decomposedInput.whispers.length > 0 && (
            <div className="composer-mention-chips-strip">
              <span className="composer-mention-chips-label">
                Targeted Whispers:
              </span>
              {decomposedInput.whispers.map((w) => (
                <div key={w.character_id} className="composer-mention-chip">
                  <span className="mention-chip-name">@{w.character_name}</span>
                  {w.target_scope === "local" ? (
                    <span className="mention-badge-present">
                      <span className="presence-dot emerald" />
                      In Location
                    </span>
                  ) : (
                    <span className="mention-badge-remote">
                      <Radio size={9} />
                      Comms
                    </span>
                  )}
                  {w.speech_parts.length > 0 && (
                    <span
                      className="mention-chip-tag speech"
                      title="Spoken dialogue (in quotes)"
                    >
                      <MessageSquare size={10} />
                      {w.speech_parts.length}
                    </span>
                  )}
                  {w.sensory_parts.length > 0 && (
                    <span
                      className="mention-chip-tag sensory"
                      title="Sensory / perception whisper (outside quotes)"
                    >
                      <Eye size={10} />
                      {w.sensory_parts.length}
                    </span>
                  )}
                  <button
                    type="button"
                    className="mention-chip-remove"
                    onClick={() => handleRemoveMentionChip(w.character_name)}
                    title={`Remove whisper to ${w.character_name}`}
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="composer-input-wrapper">
            <CharacterMentionPicker
              isOpen={mentionPickerOpen}
              filterText={mentionQuery}
              characters={mentionCharacters ?? allCampaignCharacters}
              presentCharacterIds={presentCharacterIds}
              selectedIndex={mentionSelectedIndex}
              mode={mentionMode}
              onSelect={handleSelectMention}
              onClose={() => setMentionPickerOpen(false)}
            />
            <SlashCommandPicker
              isOpen={slashPickerOpen && !mentionPickerOpen}
              stage={slashPickerStage}
              items={slashPickerItems}
              selectedIndex={slashSelectedIndex}
              onSelect={(item) => onSelectSlashItem?.(item)}
              onHoverIndex={(idx) => setSlashSelectedIndex?.(idx)}
              onClose={() => onDismissSlashPicker?.()}
            />
            <div
              className={
                activeSlashSpec
                  ? "composer-pill-input-row"
                  : "composer-plain-input-row"
              }
            >
              {activeSlashSpec && activeSlash && (
                <span
                  className={`composer-slash-pill composer-slash-pill--${activeSlashSpec.accent}`}
                  data-command={activeSlashSpec.id}
                >
                  <SlashCommandIcon iconKey={activeSlashSpec.iconKey} size={13} />
                  <span className="composer-slash-pill-label">
                    {activeSlashSpec.name}
                  </span>
                  {activeSlash.subcommand && (
                    <span className="composer-slash-subpill">
                      {activeSlash.subcommand}
                    </span>
                  )}
                  <button
                    type="button"
                    className="composer-slash-pill-clear"
                    onClick={() => onClearActiveSlash?.()}
                    aria-label={`Remove /${activeSlashSpec.name} command`}
                    title={`Remove /${activeSlashSpec.name} (Backspace at start)`}
                  >
                    <X size={11} />
                  </button>
                </span>
              )}
              <textarea
                ref={textareaRef}
                className={
                  activeSlashSpec
                    ? "composer-textarea composer-textarea--with-pill"
                    : "composer-textarea"
                }
                placeholder={
                  activeSlashSpec
                    ? slashSyntaxHint?.placeholder || "Press Enter to run..."
                    : editingTurn
                    ? "Edit your action or dialogue... (Modify text, @whispers, dice, or staged choices)"
                    : totalStagedOptionsCount > 0
                    ? "Optional user action / dialogue (Leave blank to let characters act on your staged choices)..."
                    : presentCharacters.length === 0
                    ? `You are alone in ${activeLocationName || "this location"}. Describe your action... (Type / for commands, @ for comms)`
                    : `Write your action or dialogue to ${character.name}... (Type / for commands, @ for whispers)`
                }
                value={inputText}
                onChange={(e) => {
                  const val = e.target.value;
                  const cursor = e.target.selectionStart ?? val.length;
                  if (onComposerInputChange) {
                    onComposerInputChange(val, cursor);
                  } else {
                    setInputText(val);
                    checkAndTriggerMention(val, cursor);
                  }
                }}
                onClick={(e) => {
                  const cursor =
                    e.currentTarget.selectionStart ?? inputText.length;
                  onComposerCursorChange?.(cursor);
                }}
                onKeyUp={(e) => {
                  if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
                    const cursor =
                      e.currentTarget.selectionStart ?? inputText.length;
                    if (onComposerCursorChange) {
                      onComposerCursorChange(cursor);
                    } else {
                      checkAndTriggerMention(inputText, cursor);
                    }
                  }
                }}
                onKeyDown={(e) => {
                  if (mentionPickerOpen && filteredMentionCharacters.length > 0) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setMentionSelectedIndex(
                        (prev) => (prev + 1) % filteredMentionCharacters.length
                      );
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setMentionSelectedIndex(
                        (prev) =>
                          (prev - 1 + filteredMentionCharacters.length) %
                          filteredMentionCharacters.length
                      );
                      return;
                    }
                    if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
                      e.preventDefault();
                      const picked =
                        filteredMentionCharacters[mentionSelectedIndex] ||
                        filteredMentionCharacters[0];
                      if (picked) {
                        handleSelectMention(picked);
                      }
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      setMentionPickerOpen(false);
                      return;
                    }
                  }
                  if (
                    slashPickerOpen &&
                    slashPickerItems.length > 0 &&
                    !mentionPickerOpen
                  ) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setSlashSelectedIndex?.((prev) =>
                        findNextEnabledIndex(slashPickerItems, prev, 1)
                      );
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setSlashSelectedIndex?.((prev) =>
                        findNextEnabledIndex(slashPickerItems, prev, -1)
                      );
                      return;
                    }
                    if (e.key === "Tab") {
                      e.preventDefault();
                      const picked =
                        slashPickerItems[slashSelectedIndex] ||
                        slashPickerItems.find((item) => item.available);
                      if (picked && picked.available) {
                        onSelectSlashItem?.(picked);
                      }
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (
                        slashPickerStage === "command" &&
                        isExactZeroArgCommandText(
                          inputText,
                          effectiveSlashAvailability
                        ) !== null
                      ) {
                        handleSend(e);
                        return;
                      }
                      const picked =
                        slashPickerItems[slashSelectedIndex] ||
                        slashPickerItems.find((item) => item.available);
                      if (picked && picked.available) {
                        onSelectSlashItem?.(picked);
                      }
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      onDismissSlashPicker?.();
                      return;
                    }
                  }
                  if (
                    e.key === "Backspace" &&
                    !e.ctrlKey &&
                    !e.metaKey &&
                    !e.altKey &&
                    activeSlash !== null &&
                    e.currentTarget.selectionStart === 0 &&
                    e.currentTarget.selectionEnd === 0
                  ) {
                    e.preventDefault();
                    onBackspaceSlashPill?.();
                    return;
                  }
                  if (e.key === "Escape") {
                    if (activeTray !== "none") {
                      e.preventDefault();
                      e.stopPropagation();
                      setActiveTray("none");
                      return;
                    }
                    if (editingTurn) {
                      e.preventDefault();
                      e.stopPropagation();
                      handleCancelEdit();
                      return;
                    }
                  }
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
            </div>
            <div className="composer-wand-slot">
              <MagicWandButton
                wand={magicWand}
                isInputEmpty={!inputText.trim() && !activeSlash}
                isSlashCommand={
                  Boolean(activeSlash) || inputText.trim().startsWith("/")
                }
              />
            </div>
          </div>

          {slashHardError ? (
            <div className="party-slash-warning" role="alert">
              <AlertTriangle size={12} />
              <span>{slashHardError}</span>
            </div>
          ) : partySlashWarning ? (
            <div className="party-slash-warning" role="alert">
              <AlertTriangle size={12} />
              <span>{partySlashWarning}</span>
            </div>
          ) : choiceSlashWarning ? (
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
          ) : slashSyntaxHint?.showStrip ? (
            <div className="composer-slash-hint">
              <code>{slashSyntaxHint.syntax}</code>
              <span className="composer-slash-hint-example">
                e.g. {slashSyntaxHint.example}
              </span>
            </div>
          ) : null}

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
                  disabled={neighborLocations.length === 0}
                  onClick={() =>
                    setActivePopover((prev) =>
                      prev === "exits" ? "none" : "exits"
                    )
                  }
                  title="Immediate exits from this location"
                >
                  <Compass size={12} color="var(--accent-cyan)" />
                  <span>Exits ({neighborLocations.length})</span>
                  <ChevronDown size={11} style={{ opacity: 0.7 }} />
                </button>

                {activePopover === "exits" &&
                  neighborLocations.length > 0 && (
                    <div className="composer-flyout-menu exits-menu" role="menu">
                      <div className="composer-flyout-header">
                        <Compass size={11} />
                        <span>Connected Paths (Click to Travel)</span>
                      </div>
                      {neighborLocations.map((nb) => (
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
                disabled={presentCharacters.length === 0}
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
                title={
                  presentCharacters.length === 0
                    ? "No characters present in this location to guide"
                    : "Present character choices to guide cognition [/choice]"
                }
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

              {/* Cancel Edit Button (when editing) */}
              {editingTurn && (
                <button
                  type="button"
                  className="btn composer-cancel-btn"
                  onClick={handleCancelEdit}
                  title="Cancel editing and restore previous draft (Escape)"
                >
                  <X size={13} />
                  <span>Cancel</span>
                </button>
              )}

              {/* Send or Save & Swipe Button */}
              <button
                type="submit"
                className="btn btn-amber composer-send-btn"
                disabled={
                  isBusy ||
                  Boolean(slashHardError) ||
                  Boolean(partySlashWarning) ||
                  (!inputText.trim() &&
                    !activeSlash &&
                    totalStagedOptionsCount === 0) ||
                  (diceMode === "forced" &&
                    diceOverride.trim() !== "" &&
                    (isNaN(parseInt(diceOverride, 10)) ||
                      parseInt(diceOverride, 10) < 1 ||
                      parseInt(diceOverride, 10) > 20))
                }
                title={
                  editingTurn
                    ? "Save modifications and generate a new swipe branch (Enter)"
                    : "Send turn (Enter)"
                }
              >
                {editingTurn ? (
                  <>
                    <RefreshCw size={13} className={isBusy ? "spinning" : ""} />
                    <span>Save &amp; Swipe</span>
                  </>
                ) : (
                  <>
                    <Send size={14} />
                    <span>Send</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </form>
  );
};
