import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CharacterRecord } from "../../types";
import {
  detectSlashAutocompleteContext,
  getActiveSlashHint,
  type SlashCommandAvailabilityContext,
} from "../../utils/slashCommands";
import { ChatComposer } from "../chat/ChatComposer";
import { SlashCommandPicker } from "../chat/SlashCommandPicker";
import { SlashHelpTray } from "../chat/SlashHelpTray";

const YULIA: CharacterRecord = {
  id: "char_yulia",
  version: 1,
  name: "Yulia Halim",
  tagline: "Signal courier",
  physical_appearance: "Leather coat",
  core_persona: "Watchful",
  communication_style: ["Terse"],
  quirks_flaws: ["Guarded"],
  moral_code: ["Honor contracts"],
  baseline_psyche: {
    mood_label: "Alert",
    valence: 0.1,
    arousal: 0.6,
    core_drive: "Protect crew",
    core_fear: "Exposure",
    default_want: "Exit clean",
    default_plan: "Watch perimeter",
  },
  voice_anchors: [],
  equipped: [],
  inventory: [],
  memory_shards: [],
  initial_message: "Keep moving.",
  tags: [],
  creator: "test",
  creator_notes: "",
  portraits: {},
  gallery: [],
  created_at: "2026-01-01T00:00:00Z",
};

const DEFAULT_CTX: SlashCommandAvailabilityContext = {
  presentCharacterCount: 1,
  eligiblePartyInviteCount: 1,
  inPlayerParty: true,
  isEditingTurn: false,
};

function renderComposer(
  overrides: Partial<React.ComponentProps<typeof ChatComposer>> = {}
) {
  return renderToStaticMarkup(
    <ChatComposer
      composerBarRef={{ current: null }}
      narratorBtnRef={{ current: null }}
      exitsBtnRef={{ current: null }}
      textareaRef={{ current: null }}
      character={YULIA}
      editingTurn={null}
      activeTray="none"
      setActiveTray={vi.fn()}
      activePopover="none"
      setActivePopover={vi.fn()}
      customDirectiveText=""
      setCustomDirectiveText={vi.fn()}
      presentCharacters={[YULIA]}
      allCampaignCharacters={[YULIA]}
      presentCharacterIds={[YULIA.id]}
      stagedChoices={{}}
      activeChoiceCharId={YULIA.id}
      setActiveChoiceCharId={vi.fn()}
      activeCharRecord={YULIA}
      totalStagedOptionsCount={0}
      diceMode="auto"
      setDiceMode={vi.fn()}
      diceOverride=""
      setDiceOverride={vi.fn()}
      hasActiveGates={false}
      choicePreview={null}
      choiceSlashWarning={null}
      partySlashWarning={null}
      decomposedInput={{
        raw_message: "",
        public_text: "",
        whispers: [],
        whispers_by_character_id: {},
        remote_whispers: [],
      }}
      mentionPickerOpen={false}
      setMentionPickerOpen={vi.fn()}
      mentionQuery=""
      mentionSelectedIndex={0}
      setMentionSelectedIndex={vi.fn()}
      filteredMentionCharacters={[]}
      inputText=""
      setInputText={vi.fn()}
      isBusy={false}
      magicWand={{
        status: "idle",
        error: null,
        canEnrich: false,
        canRevert: false,
        isDirtyAfterApply: false,
        triggerEnrich: vi.fn(),
        cancelEnrich: vi.fn(),
        revert: vi.fn(),
        dismissUndo: vi.fn(),
        reset: vi.fn(),
      }}
      activeLocationName="Neon Rust Floor"
      neighborLocations={[]}
      handleSelectMention={vi.fn()}
      handleRemoveMentionChip={vi.fn()}
      checkAndTriggerMention={vi.fn()}
      handleInvokeNarrator={vi.fn()}
      handleQuickExit={vi.fn()}
      handleSendCustomDirective={vi.fn()}
      handleClearAllChoices={vi.fn()}
      handleClearCharChoices={vi.fn()}
      handleSetDC={vi.fn()}
      handleAddOption={vi.fn()}
      handleUpdateOption={vi.fn()}
      handleRemoveOption={vi.fn()}
      handleCancelEdit={vi.fn()}
      handleSend={vi.fn()}
      slashAvailabilityContext={DEFAULT_CTX}
      {...overrides}
    />
  );
}

describe("slash command UI rendering", () => {
  it("renders Stage-1 alphabetical picker with syntax, alias badge, and disabled reasons", () => {
    const soloCtx: SlashCommandAvailabilityContext = {
      presentCharacterCount: 0,
      eligiblePartyInviteCount: 0,
      inPlayerParty: false,
      isEditingTurn: false,
    };
    const stage1 = detectSlashAutocompleteContext("/", 1, null, soloCtx)!;
    const html = renderToStaticMarkup(
      <SlashCommandPicker
        isOpen
        stage={stage1.stage}
        items={stage1.items}
        selectedIndex={1}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(html).toContain("Slash Commands");
    expect(html).toContain("/choice");
    expect(html).toContain("Requires someone present");
    expect(html).toContain('aria-disabled="true"');
    const choiceIdx = html.indexOf("/choice");
    const eventIdx = html.indexOf("/event");
    const waitIdx = html.indexOf("/wait");
    expect(choiceIdx).toBeLessThan(eventIdx);
    expect(eventIdx).toBeLessThan(waitIdx);

    const aliasStage = detectSlashAutocompleteContext("/desc", 5, null, DEFAULT_CTX)!;
    const aliasHtml = renderToStaticMarkup(
      <SlashCommandPicker
        isOpen
        stage={aliasStage.stage}
        items={aliasStage.items}
        selectedIndex={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(aliasHtml).toContain("alias: /describe");
    expect(aliasHtml).toContain("/look");

    const stage2 = detectSlashAutocompleteContext(
      "",
      0,
      { command: "party", subcommand: null },
      DEFAULT_CTX
    )!;
    const stage2Html = renderToStaticMarkup(
      <SlashCommandPicker
        isOpen
        stage={stage2.stage}
        items={stage2.items}
        selectedIndex={0}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(stage2Html).toContain("/party Subcommands");
    expect(stage2Html).toContain("disband");
    expect(stage2Html).toContain("kick");
  });

  it("renders inline command pill, subcommand pill, syntax hint, and hard-block priority", () => {
    const activeKick = { command: "party" as const, subcommand: "kick" as const };
    const pillHtml = renderComposer({
      activeSlash: activeKick,
      slashSyntaxHint: getActiveSlashHint(activeKick),
      inputText: "@Yulia",
    });
    expect(pillHtml).toContain("composer-slash-pill--violet");
    expect(pillHtml).toContain('class="composer-slash-pill-label">party</span>');
    expect(pillHtml).toContain('class="composer-slash-subpill">kick</span>');
    expect(pillHtml).toContain("Remove /party command");
    expect(pillHtml).toContain("composer-slash-hint");
    expect(pillHtml).toContain("/party kick @Name ... [message]");

    // Hard-block error suppresses syntax hint and disables Send
    const errHtml = renderComposer({
      inputText: "/halp",
      slashHardError: 'Unknown command "/halp". Type /help to see available commands.',
      slashSyntaxHint: getActiveSlashHint(activeKick),
    });
    expect(errHtml).toContain('role="alert"');
    expect(errHtml).toContain("Unknown command &quot;/halp&quot;");
    expect(errHtml).not.toContain("composer-slash-hint");
    expect(errHtml).toMatch(/class="btn btn-amber composer-send-btn"[^>]*disabled/);

    // 0-arg committed /look pill enables Send even with empty inputText
    const lookHtml = renderComposer({
      activeSlash: { command: "look", subcommand: null },
      slashSyntaxHint: getActiveSlashHint({ command: "look", subcommand: null }),
      inputText: "",
    });
    expect(lookHtml).toContain("composer-slash-pill--cyan");
    expect(lookHtml).toContain("AI enhancement unavailable for slash commands");
    expect(lookHtml).not.toMatch(/class="btn btn-amber composer-send-btn"[^>]*disabled/);
  });

  it("renders /help above-composer tray with all commands alphabetically and composer reference", () => {
    const soloNoParty: SlashCommandAvailabilityContext = {
      presentCharacterCount: 0,
      eligiblePartyInviteCount: 0,
      inPlayerParty: false,
      isEditingTurn: false,
    };
    const trayHtml = renderComposer({
      activeTray: "slash_help",
      slashAvailabilityContext: soloNoParty,
    });
    expect(trayHtml).toContain("Slash Commands &amp; Composer Shortcuts");
    expect(trayHtml).toContain("Requires someone present");
    expect(trayHtml).toContain("Not in a party");
    expect(trayHtml).toContain("Also in Composer:");
    expect(trayHtml).toContain("@Character: &quot;spoken&quot; sensory");
    expect(trayHtml).toContain("@critfail");

    const standaloneHtml = renderToStaticMarkup(
      <SlashHelpTray
        availabilityContext={DEFAULT_CTX}
        onInsertCommand={vi.fn()}
        onClose={vi.fn()}
      />
    );
    const orderedNames = ["/choice", "/event", "/help", "/look", "/narrate", "/party", "/wait"];
    let lastPos = -1;
    for (const cmd of orderedNames) {
      const pos = standaloneHtml.indexOf(cmd);
      expect(pos).toBeGreaterThan(lastPos);
      lastPos = pos;
    }
  });
});
