import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CharacterRecord } from "../../types";
import { GM_GREETING_MESSAGE } from "../../utils/gmMentions";
import { ExportCampaignModal } from "../ExportCampaignModal";
import {
  ProfileBehaviorCards,
  type ProfileBehaviorValues,
} from "../auth/ProfileBehaviorCards";
import { ChatComposer, type ChatComposerProps } from "../chat/ChatComposer";
import { GmCodexProposalCard } from "../chat/GmCodexProposalCard";
import { GmMentionPopover } from "../chat/GmMentionPopover";
import { GmTalkDrawer } from "../chat/GmTalkDrawer";

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

const BASE_BEHAVIOR: ProfileBehaviorValues = {
  workingMemoryTurns: 12,
  minWorkingMemoryTurns: 4,
  lodSummaryChunks: 6,
  lodImportanceBonus: 2,
  zone2BudgetSharePct: 45,
  recallBudgetProseTokens: 450,
  recallBudgetCognitionTokens: 220,
  maxSceneFlags: 10,
  agentDispatchMode: "sequential",
  personaDisclosureMode: "llm_intent",
  delegateCognitionToClerk: false,
  gmModelRole: "primary",
  gmTemperature: 0.5,
  gmMaxTokens: 1024,
};

function makeBaseComposerProps(): ChatComposerProps {
  return {
    composerBarRef: { current: null },
    narratorBtnRef: { current: null },
    exitsBtnRef: { current: null },
    textareaRef: { current: null },
    character: YULIA,
    editingTurn: null,
    activeTray: "none",
    setActiveTray: vi.fn(),
    activePopover: "none",
    setActivePopover: vi.fn(),
    customDirectiveText: "",
    setCustomDirectiveText: vi.fn(),
    presentCharacters: [YULIA],
    allCampaignCharacters: [YULIA],
    presentCharacterIds: [YULIA.id],
    stagedChoices: {},
    activeChoiceCharId: YULIA.id,
    setActiveChoiceCharId: vi.fn(),
    activeCharRecord: YULIA,
    totalStagedOptionsCount: 0,
    diceMode: "auto",
    setDiceMode: vi.fn(),
    diceOverride: "",
    setDiceOverride: vi.fn(),
    hasActiveGates: false,
    choicePreview: null,
    choiceSlashWarning: null,
    decomposedInput: {
      raw_message: "",
      public_text: "",
      whispers: [],
      whispers_by_character_id: {},
      remote_whispers: [],
    },
    mentionPickerOpen: false,
    setMentionPickerOpen: vi.fn(),
    mentionQuery: "",
    mentionSelectedIndex: 0,
    setMentionSelectedIndex: vi.fn(),
    filteredMentionCharacters: [],
    inputText: "I check the lock.",
    setInputText: vi.fn(),
    isBusy: false,
    magicWand: {
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
    },
    activeLocationName: "Neon Rust Floor",
    neighborLocations: [],
    handleSelectMention: vi.fn(),
    handleRemoveMentionChip: vi.fn(),
    checkAndTriggerMention: vi.fn(),
    handleInvokeNarrator: vi.fn(),
    handleQuickExit: vi.fn(),
    handleSendCustomDirective: vi.fn(),
    handleClearAllChoices: vi.fn(),
    handleClearCharChoices: vi.fn(),
    handleSetDC: vi.fn(),
    handleAddOption: vi.fn(),
    handleUpdateOption: vi.fn(),
    handleRemoveOption: vi.fn(),
    handleCancelEdit: vi.fn(),
    handleSend: vi.fn(),
    onOpenGmTalk: vi.fn(),
  };
}

describe("GM Talk UI components", () => {
  it("renders Talk to GM button immediately to the left of Narrator in Story Mode and switches actions in GM Mode", () => {
    const storyHtml = renderToStaticMarkup(
      <ChatComposer {...makeBaseComposerProps()} />
    );

    const talkIdx = storyHtml.indexOf("Talk to GM");
    const narratorIdx = storyHtml.indexOf(">Narrator<");
    expect(talkIdx).toBeGreaterThan(-1);
    expect(narratorIdx).toBeGreaterThan(talkIdx);
    expect(storyHtml).toContain("I check the lock.");

    const gmComposerHtml = renderToStaticMarkup(
      <ChatComposer
        {...makeBaseComposerProps()}
        gmMode={{
          isActive: true,
          isStreaming: false,
          isCampaignStreaming: false,
          draftText: "What happened in @Turn 1?",
          pinnedMentions: [{ kind: "turn", id: "turn_1", label: "Turn 1" }],
          mentionTrigger: null,
          mentionPopoverOpen: false,
          mentionItems: [],
          mentionLoading: false,
          mentionSelectedIndex: 0,
          onHoverMentionIndex: vi.fn(),
          onDraftChange: vi.fn(),
          onDraftCursorChange: vi.fn(),
          onSelectMentionCategory: vi.fn(),
          onSelectMentionCandidate: vi.fn(),
          onPopCategoryToBrowse: vi.fn(() => false),
          onDismissMentionPopover: vi.fn(),
          onRemovePinnedMention: vi.fn(),
          onInsertAtTrigger: vi.fn(),
          onSend: vi.fn(),
          onStop: vi.fn(),
          onToggleOpen: vi.fn(),
          onMinimize: vi.fn(),
        }}
      />
    );

    expect(gmComposerHtml).toContain("composer-bar--gm");
    expect(gmComposerHtml).toContain("What happened in @Turn 1?");
    expect(gmComposerHtml).not.toContain("I check the lock.");
    expect(gmComposerHtml).toContain("Browse @");
    expect(gmComposerHtml).toContain("Minimize");
    expect(gmComposerHtml).toContain("Ask GM");
    expect(gmComposerHtml).toContain("gm-mention-chip");
    expect(gmComposerHtml).not.toContain(">Narrator<");
    expect(gmComposerHtml).not.toContain(">Choices<");
  });

  it("renders Neuromancer slide-out drawer with greeting, Spoiler-Safe vs GM Mode pills, closing class, and persisted messages", () => {
    const blankSafeHtml = renderToStaticMarkup(
      <GmTalkDrawer
        campaignTitle="Kowloon Run"
        worldName="New Kowloon"
        unlockLore={false}
        isClosing={false}
        isExpanded={false}
        isCampaignStreaming={false}
        messages={[]}
        isLoading={false}
        isStreaming={false}
        streamingText=""
        streamingSources={[]}
        error={null}
        clearConfirm={false}
        isClearing={false}
        copiedId={null}
        expandedSources={{}}
        modelMeta={{
          role: "primary",
          modelName: "qwen3:14b",
          temperature: 0.5,
          maxTokens: 1024,
        }}
        onInsertAtTrigger={vi.fn()}
        onClearChat={vi.fn()}
        onCopyMessage={vi.fn()}
        onToggleSources={vi.fn()}
        onDismissError={vi.fn()}
        onToggleExpanded={vi.fn()}
        onMinimize={vi.fn()}
      />
    );
    expect(blankSafeHtml).toContain("gm-slideout-panel");
    expect(blankSafeHtml).toContain("Neuromancer · GM Talk");
    expect(blankSafeHtml).toContain("Spoiler-Safe");
    expect(blankSafeHtml).toContain(
      GM_GREETING_MESSAGE.replace(/'/g, "&#x27;")
    );
    expect(blankSafeHtml).toContain("Clear Chat");
    expect(blankSafeHtml).toContain("Minimize GM Talk");

    const unlockedClosingHtml = renderToStaticMarkup(
      <GmTalkDrawer
        campaignTitle="Kowloon Run"
        worldName="New Kowloon"
        unlockLore={true}
        isClosing={true}
        isExpanded={true}
        isCampaignStreaming={false}
        messages={[
          {
            id: "gm_1",
            campaign_id: "camp_1",
            anchor_turn_id: "turn_1",
            role: "user",
            content: "What happened in @Turn 1?",
            mentions: [{ kind: "turn", id: "turn_1", label: "Turn 1" }],
            sources: [],
            created_at: "2026-11-23T10:00:00Z",
          },
          {
            id: "gm_2",
            campaign_id: "camp_1",
            anchor_turn_id: "turn_1",
            role: "assistant",
            content: "You *signaled* the drop.",
            mentions: [],
            sources: [{ kind: "turn", id: "turn_1", label: "Turn 1" }],
            created_at: "2026-11-23T10:00:01Z",
          },
        ]}
        isLoading={false}
        isStreaming={false}
        streamingText=""
        streamingSources={[]}
        error={null}
        clearConfirm={false}
        isClearing={false}
        copiedId={null}
        expandedSources={{}}
        modelMeta={null}
        onInsertAtTrigger={vi.fn()}
        onClearChat={vi.fn()}
        onCopyMessage={vi.fn()}
        onToggleSources={vi.fn()}
        onDismissError={vi.fn()}
        onToggleExpanded={vi.fn()}
        onMinimize={vi.fn()}
      />
    );
    expect(unlockedClosingHtml).toContain("gm-slideout-panel--closing");
    expect(unlockedClosingHtml).toContain("gm-slideout-panel--expanded");
    expect(unlockedClosingHtml).toContain("GM Mode · Secrets Unlocked");
    expect(unlockedClosingHtml).toContain("@Turn 1");
    expect(unlockedClosingHtml).toContain("<em>signaled</em>");
    expect(unlockedClosingHtml).toContain("Sources used (1)");
  });

  it("renders Antigravity-style Browse and Category search views in GmMentionPopover", () => {
    const browseHtml = renderToStaticMarkup(
      <GmMentionPopover
        trigger={{ mode: "browse", query: "", tokenStart: 0, tokenEnd: 1 }}
        items={[]}
        loading={false}
        selectedIndex={0}
        onHoverIndex={vi.fn()}
        onSelectCategory={vi.fn()}
        onSelectCandidate={vi.fn()}
      />
    );
    expect(browseHtml).toContain("Browse");
    expect(browseHtml).toContain("Characters");
    expect(browseHtml).toContain("Lore");
    expect(browseHtml).toContain("Locations");
    expect(browseHtml).toContain("Containers");
    expect(browseHtml).toContain("Turns");

    const turnsHtml = renderToStaticMarkup(
      <GmMentionPopover
        trigger={{
          mode: "category",
          category: "turns",
          query: "2",
          tokenStart: 0,
          tokenEnd: 8,
        }}
        items={[
          {
            kind: "turn",
            category: "turns",
            id: "turn_2",
            label: "Turn 2",
            subtitle: "Inspecting the neon hatch",
            badge: "Bookmarked",
          },
        ]}
        loading={false}
        selectedIndex={0}
        onHoverIndex={vi.fn()}
        onSelectCategory={vi.fn()}
        onSelectCandidate={vi.fn()}
      />
    );
    expect(turnsHtml).toContain("Turn 2");
    expect(turnsHtml).toContain("Inspecting the neon hatch");
    expect(turnsHtml).toContain("Bookmarked");
  });

  it("renders 5th GM Talk behavior card and Include GM conversations export toggle (unchecked by default)", () => {
    const cardsHtml = renderToStaticMarkup(
      <ProfileBehaviorCards
        values={BASE_BEHAVIOR}
        defaults={BASE_BEHAVIOR}
        isLocked={false}
        onChangeField={vi.fn()}
      />
    );
    expect(cardsHtml).toContain("GM Talk");
    expect(cardsHtml).toContain("GM Model Role");
    expect(cardsHtml).toContain("GM Temperature");
    expect(cardsHtml).toContain("GM Max Tokens");

    const exportHtml = renderToStaticMarkup(
      <ExportCampaignModal
        campaign={{
          id: "camp_1",
          name: "Kowloon Run",
          world_id: "w_1",
          character_id: "c_1",
          created_at: "2026-11-23T10:00:00Z",
        }}
        onClose={vi.fn()}
      />
    );
    expect(exportHtml).toContain("Include GM conversations");
    expect(exportHtml).not.toMatch(/Include GM conversations[\s\S]{0,80}checked/);
  });

  it("renders Draft Codex button on GM messages and GmCodexProposalCard states (pending, duplicates, confirmed, cancelled)", () => {
    const baseProposal = {
      id: "prop_1",
      status: "pending" as const,
      draft: {
        title: "Aegis Mobile Scanner Arch",
        category: "threat" as const,
        content: "A wheeled inspection arch deployed in Sector 9; limits unconfirmed.",
        entity_tags: ["aegis", "scanner"],
      },
      source_turns: [12, 14],
      duplicate_matches: [
        {
          id: "lore_base_1",
          title: "Aegis Directorate",
          category: "faction" as const,
          is_base_world: true,
          match_reason: "Similar title",
        },
        {
          id: "lore_camp_2",
          title: "Aegis Scanner Note",
          category: "artifact" as const,
          is_base_world: false,
          match_reason: "Shared tags: aegis",
        },
      ],
      replace_lore_id: null,
      saved_lore_id: null,
      created_at: "2026-11-23T15:00:00Z",
    };

    const drawerWithProposalHtml = renderToStaticMarkup(
      <GmTalkDrawer
        campaignTitle="Sector 9 Run"
        worldName="New Kowloon"
        unlockLore={false}
        isClosing={false}
        isExpanded={false}
        isCampaignStreaming={false}
        messages={[
          {
            id: "gm_asst_1",
            campaign_id: "camp_1",
            anchor_turn_id: "turn_14",
            role: "assistant",
            content: "It was a mobile Aegis security scanner arch.",
            mentions: [],
            sources: [],
            proposals: [baseProposal],
            created_at: "2026-11-23T15:00:00Z",
          },
        ]}
        isLoading={false}
        isStreaming={false}
        streamingText=""
        streamingSources={[]}
        error={null}
        clearConfirm={false}
        isClearing={false}
        copiedId={null}
        expandedSources={{}}
        modelMeta={null}
        onInsertAtTrigger={vi.fn()}
        onClearChat={vi.fn()}
        onCopyMessage={vi.fn()}
        onToggleSources={vi.fn()}
        onDraftCodexEntry={vi.fn()}
        onConfirmCodexProposal={vi.fn()}
        onCancelCodexProposal={vi.fn()}
        onOpenCodex={vi.fn()}
        onDismissError={vi.fn()}
        onToggleExpanded={vi.fn()}
        onMinimize={vi.fn()}
      />
    );

    expect(drawerWithProposalHtml).toContain("Draft Codex");
    expect(drawerWithProposalHtml).toContain("Proposed World Codex Entry");
    expect(drawerWithProposalHtml).toContain("Aegis Mobile Scanner Arch");
    expect(drawerWithProposalHtml).toContain("Grounded in Turns 12, 14");
    expect(drawerWithProposalHtml).toContain("Similar World Codex entries already exist:");
    expect(drawerWithProposalHtml).toContain("Aegis Directorate");
    expect(drawerWithProposalHtml).toContain("requires GM Mode");
    expect(drawerWithProposalHtml).toContain("Confirm &amp; Add to Codex");
    expect(drawerWithProposalHtml).toContain("/ 2000");

    const confirmedHtml = renderToStaticMarkup(
      <GmCodexProposalCard
        proposal={{
          ...baseProposal,
          status: "confirmed",
          saved_lore_id: "lore_saved_1",
        }}
        unlockLore={false}
        onOpenCodex={vi.fn()}
      />
    );
    expect(confirmedHtml).toContain("Saved to World Codex");
    expect(confirmedHtml).toContain("Open Codex");

    const cancelledHtml = renderToStaticMarkup(
      <GmCodexProposalCard
        proposal={{
          ...baseProposal,
          status: "cancelled",
        }}
        unlockLore={false}
      />
    );
    expect(cancelledHtml).toContain("Codex proposal dismissed");
  });
});
