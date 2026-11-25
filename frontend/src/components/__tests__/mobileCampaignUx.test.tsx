import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  CampaignStateBundle,
  CharacterRecord,
  CharacterStateSnapshot,
  LocationNode,
  NeighborLocationView,
  TurnNodeRecord,
  WorldRecord,
  WorldStateSnapshot,
} from "../../types";
import { ChatStage } from "../ChatStage";
import { ChatComposer, type ChatComposerProps } from "../chat/ChatComposer";
import { DirectorChoicesDrawer } from "../chat/DirectorChoicesDrawer";
import { GmTalkDrawer } from "../chat/GmTalkDrawer";
import { TurnCard } from "../chat/TurnCard";
import {
  TurnSwipeSwitcher,
  buildSwipePreviewText,
} from "../chat/TurnSwipeSwitcher";
import {
  isTurnFeedScrolledAwayFromBottom,
  shouldEnterSubmitComposer,
} from "../chat/chatHelpers";
import { splitWorldClockDisplay } from "../chat/worldClockDisplay";
import { InspectorLocationCard } from "../inspector/InspectorLocationCard";
import {
  MAX_GRAPH_ZOOM,
  MIN_GRAPH_ZOOM,
  computeBranchPinchViewport,
} from "../story/branchGraphLayout";
import { WorldCodexTab } from "../world/WorldCodexTab";
import { WorldInspectorModal } from "../world/WorldInspectorModal";
import { CodexMechanicsDetail } from "../world/mechanics/CodexMechanicsDetail";
import {
  ORDERED_MECHANICS_ARTICLES,
  getAdjacentMechanicsTopics,
  getMechanicsArticle,
} from "../world/mechanics/mechanicsHelpers";
import {
  DRAWER_SWIPE_DISMISS_PX,
  computeDrawerSwipeOffset,
  shouldDismissDrawerSwipe,
} from "../../utils/drawerSwipe";

const LOC_HUB: LocationNode = {
  id: "loc-hub",
  world_id: "w-1",
  name: "Cantina",
  summary: "Neon hub.",
  description: "Rain on chrome.",
  environmental_tags: [],
  is_starting_location: true,
  is_visited: true,
  lore_nodes: [],
  ui_x: 0,
  ui_y: 0,
};

const LOC_ALLEY: LocationNode = {
  id: "loc-alley",
  world_id: "w-1",
  name: "Back Alley",
  summary: "Steam vents.",
  description: "Narrow service corridor.",
  environmental_tags: [],
  is_starting_location: false,
  is_visited: false,
  lore_nodes: [],
  ui_x: 120,
  ui_y: 40,
};

const WORLD_FIXTURE: WorldRecord = {
  id: "w-1",
  name: "Kowloon Run",
  global_rules: {
    genre: "Cyberpunk Noir",
    tone: "Gritty",
    setting_overview: "Rain-soaked vertical megablock.",
    tech_or_magic_rules: "Chrome and ICE.",
    starting_timestamp: "2094-11-14 23:15",
  },
  created_at: "2026-01-01T00:00:00Z",
  containers: [],
  locations: [LOC_HUB, LOC_ALLEY],
  edges: [
    {
      id: "edge-1",
      world_id: "w-1",
      from_location_id: LOC_HUB.id,
      to_location_id: LOC_ALLEY.id,
      direction_label: "north",
      compass_direction: "N",
      distance_meters: 40,
      speed_modifier: 1,
      obstacles: [],
      is_blocked: false,
      is_secret: false,
    },
  ],
  lore_nodes: [
    {
      id: "lore-1",
      world_id: "w-1",
      title: "Blackout Accord",
      category: "history",
      content: "Truce signed after the grid collapse.",
      entity_tags: ["accord"],
    },
  ],
};

const NEIGHBOR_ALLEY: NeighborLocationView = {
  edge_id: "edge-1",
  direction_label: "north",
  compass_direction: "N",
  distance_meters: 40,
  speed_modifier: 1,
  obstacles: [],
  is_blocked: false,
  is_secret: false,
  destination: LOC_ALLEY,
};

const CHAR_MIRA: CharacterRecord = {
  id: "char-mira",
  version: 1,
  world_id: "w-1",
  name: "Mira",
  tagline: "Courier",
  physical_appearance: "Jacket",
  core_persona: "Sharp",
  communication_style: ["Terse"],
  quirks_flaws: ["Guarded"],
  moral_code: ["Deliver on time"],
  baseline_psyche: {
    mood_label: "focused",
    valence: 0,
    arousal: 0.2,
    core_drive: "Deliver",
    core_fear: "Failure",
    default_want: "Move",
    default_plan: "Scan",
  },
  voice_anchors: [],
  equipped: [],
  inventory: [],
  memory_shards: [],
  initial_message: "Doors slide shut.",
  tags: [],
  creator: "test",
  creator_notes: "",
  portraits: {},
  gallery: [],
  created_at: "2026-01-01T00:00:00Z",
};

function makeTurn(
  id: string,
  depth: number,
  overrides: Partial<TurnNodeRecord> = {}
): TurnNodeRecord {
  const ws: WorldStateSnapshot = {
    turn_id: id,
    world_timestamp: "2094-11-14 23:15",
    active_location_id: LOC_HUB.id,
    scene_flags: [],
    campaign_elapsed_minutes: depth * 5,
    visited_location_ids: [LOC_HUB.id],
    parties: [],
  };
  const cs: CharacterStateSnapshot = {
    turn_id: id,
    character_id: CHAR_MIRA.id,
    current_location_id: LOC_HUB.id,
    mood_label: "focused",
    valence: 0,
    arousal: 0.2,
    active_want: "Move",
    active_plan: "Scan",
    relationship_notes: {},
    equipped: [],
    inventory: [],
  };
  return {
    id,
    campaign_id: "camp-1",
    parent_turn_id: depth === 0 ? null : "t-0",
    depth_index: depth,
    user_message: depth === 0 ? "" : "Open the datapad.",
    actor_id: CHAR_MIRA.id,
    raw_prose: "Mira flicks open the datapad.",
    cognition: {
      recall: "Old courier drop.",
      feeling: "focused",
      want: "Check signal",
      plan: "Decrypt header",
      valence: 0,
      arousal: 0.2,
    },
    pre_turn: {
      user_sentiment: "neutral",
      subtext_interpretation: "",
      mentioned_entities: [],
      memory_search_queries: [],
      spatial_intent: "stay",
      mechanics_check: {
        requires_roll: false,
        action_description: "",
        skill_or_approach: "",
        difficulty_class: 10,
        relevant_modifier: 0,
      },
      active_speaker_id: CHAR_MIRA.id,
      speaker_order: [CHAR_MIRA.id],
    },
    world_snapshot: ws,
    character_state: cs,
    character_states: { [CHAR_MIRA.id]: cs },
    recalled_items: [],
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeBundle(
  activeTurns: TurnNodeRecord[],
  allTurns: TurnNodeRecord[] = activeTurns
): CampaignStateBundle {
  const leaf = activeTurns[activeTurns.length - 1];
  return {
    campaign: {
      id: "camp-1",
      name: "Kowloon Run",
      world_id: WORLD_FIXTURE.id,
      character_id: CHAR_MIRA.id,
      participant_character_ids: [CHAR_MIRA.id],
      active_leaf_turn_id: leaf.id,
      created_at: "2026-01-01T00:00:00Z",
    },
    active_branch_turns: activeTurns,
    all_turn_nodes: allTurns,
    current_world_snapshot: leaf.world_snapshot,
    current_character_state: leaf.character_state,
    character_states: leaf.character_states,
    character_records: { [CHAR_MIRA.id]: CHAR_MIRA },
    present_character_ids: [CHAR_MIRA.id],
    active_location: LOC_HUB,
    neighbor_locations: [NEIGHBOR_ALLEY],
    visible_locations: [LOC_HUB, LOC_ALLEY],
    visible_edges: WORLD_FIXTURE.edges,
    episodic_chunks: [],
    all_episodic_chunks: [],
  };
}

function makeComposerProps(): ChatComposerProps {
  return {
    composerBarRef: { current: null },
    narratorBtnRef: { current: null },
    exitsBtnRef: { current: null },
    textareaRef: { current: null },
    character: CHAR_MIRA,
    editingTurn: null,
    activeTray: "none",
    setActiveTray: vi.fn(),
    activePopover: "none",
    setActivePopover: vi.fn(),
    customDirectiveText: "",
    setCustomDirectiveText: vi.fn(),
    presentCharacters: [CHAR_MIRA],
    allCampaignCharacters: [CHAR_MIRA],
    presentCharacterIds: [CHAR_MIRA.id],
    stagedChoices: {},
    activeChoiceCharId: CHAR_MIRA.id,
    setActiveChoiceCharId: vi.fn(),
    activeCharRecord: CHAR_MIRA,
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
    inputText: "Check the relay.",
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
    activeLocationName: LOC_HUB.name,
    neighborLocations: [NEIGHBOR_ALLEY],
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
    onOpenMechanicsHelp: vi.fn(),
  };
}

describe("v0.43.0 Mobile Campaign UX & Responsive Controls", () => {
  it("renders TurnSwipeSwitcher stepper + comparison popover without colliding GitBranch icon on closed state", () => {
    const t1v1 = makeTurn("t-1a", 1, {
      user_message: "Ask about the package",
      raw_prose: "Mira taps the counter twice and slides an encrypted chip across.",
    });
    const t1v2 = makeTurn("t-1b", 1, {
      user_message: "Ask about the package",
      raw_prose: "Second sibling prose preview.",
      is_bookmarked: true,
    });
    const t1v3 = makeTurn("t-1c", 1, {
      user_message: "Demand the ledger instead",
      raw_prose:
        "Very long prose sentence that should be truncated or superseded when the player edited their prompt on this sibling branch.",
    });

    const editedPreview = buildSwipePreviewText(t1v3, t1v1.user_message);
    expect(editedPreview.isEditedPrompt).toBe(true);
    expect(editedPreview.preview).toBe("Demand the ledger instead");

    const singleHtml = renderToStaticMarkup(
      <TurnSwipeSwitcher
        turn={t1v1}
        siblings={[t1v1]}
        isBusy={false}
        isOpen={false}
        onToggle={vi.fn()}
        onClose={vi.fn()}
        onSelectTurn={vi.fn()}
      />
    );
    expect(singleHtml).toBe("");

    const firstClosedHtml = renderToStaticMarkup(
      <TurnSwipeSwitcher
        turn={t1v1}
        siblings={[t1v1, t1v2, t1v3]}
        childCountByTurnId={{ "t-1b": 3 }}
        isBusy={false}
        isOpen={false}
        onToggle={vi.fn()}
        onClose={vi.fn()}
        onSelectTurn={vi.fn()}
      />
    );
    expect(firstClosedHtml).toContain("v1/3");
    expect(firstClosedHtml).not.toContain("lucide-git-branch");
    expect(firstClosedHtml).toContain(
      'class="btn turn-swipe-step-btn" disabled="" aria-label="Previous swipe version"'
    );
    expect(firstClosedHtml).not.toContain(
      'disabled="" aria-label="Next swipe version"'
    );

    const lastClosedHtml = renderToStaticMarkup(
      <TurnSwipeSwitcher
        turn={t1v3}
        siblings={[t1v1, t1v2, t1v3]}
        isBusy={false}
        isOpen={false}
        onToggle={vi.fn()}
        onClose={vi.fn()}
        onSelectTurn={vi.fn()}
      />
    );
    expect(lastClosedHtml).toContain("v3/3");
    expect(lastClosedHtml).toContain(
      'class="btn turn-swipe-step-btn" disabled="" aria-label="Next swipe version"'
    );

    const openHtml = renderToStaticMarkup(
      <TurnSwipeSwitcher
        turn={t1v2}
        siblings={[t1v1, t1v2, t1v3]}
        childCountByTurnId={{ "t-1b": 4 }}
        isBusy={false}
        isOpen={true}
        onToggle={vi.fn()}
        onClose={vi.fn()}
        onSelectTurn={vi.fn()}
      />
    );
    expect(openHtml).toContain("turn-swipe-popover");
    expect(openHtml).toContain("Swipe Versions (3)");
    expect(openHtml).toContain(">v1<");
    expect(openHtml).toContain(">v2<");
    expect(openHtml).toContain(">Active<");
    expect(openHtml).toContain(">Edited<");
    expect(openHtml).toContain('aria-label="Bookmarked"');
    expect(openHtml).toContain("turn-swipe-branch-badge");
    expect(openHtml).toContain("+4");
    expect(openHtml).toContain("Demand the ledger instead");
  });

  it("renders TurnCard 2-tap inline Delete confirmation, divider, and cognition header detail", () => {
    const t0 = makeTurn("t-0", 0, { raw_prose: "Opening." });
    const t1 = makeTurn("t-1", 1);
    const t1Alt = makeTurn("t-1b", 1, { raw_prose: "Alt reply." });
    const bundle = makeBundle([t0, t1], [t0, t1, t1Alt]);

    const restHtml = renderToStaticMarkup(
      <TurnCard
        turn={t1}
        turnIdx={1}
        bundle={bundle}
        character={CHAR_MIRA}
        allCampaignCharacters={[CHAR_MIRA]}
        presentCharacterIds={[CHAR_MIRA.id]}
        siblings={[t1, t1Alt]}
        isBusy={false}
        isDeletingTurn={false}
        isEditingThisTurn={false}
        hasActiveEditingTurn={false}
        hasDeleteLastHandler={true}
        hasDescendants={false}
        cogOpen={true}
        memOpen={false}
        phase4ProgressByTurn={{}}
        lastTurnId={t1.id}
        onToggleCognition={vi.fn()}
        onToggleMemories={vi.fn()}
        onCheckoutTurn={vi.fn()}
        onStartEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onSwipeRegenerate={vi.fn()}
        onDeleteLast={vi.fn()}
        onOpenAgentModal={vi.fn()}
      />
    );
    expect(restHtml).toContain("turn-swipe-switcher");
    expect(restHtml).toContain("turn-actions-divider");
    expect(restHtml).toContain("turn-delete-label");
    expect(restHtml).toContain(">Delete<");
    expect(restHtml).toContain('aria-label="Delete last message and its unfollowed swipes"');
    expect(restHtml).not.toContain("turn-delete-btn--confirm");
    expect(restHtml).toContain("cognition-header-detail");

    const armedHtml = renderToStaticMarkup(
      <TurnCard
        turn={t1}
        turnIdx={1}
        bundle={bundle}
        character={CHAR_MIRA}
        allCampaignCharacters={[CHAR_MIRA]}
        presentCharacterIds={[CHAR_MIRA.id]}
        siblings={[t1, t1Alt]}
        isBusy={false}
        isDeletingTurn={false}
        isEditingThisTurn={false}
        hasActiveEditingTurn={false}
        hasDeleteLastHandler={true}
        hasDescendants={false}
        cogOpen={false}
        memOpen={false}
        phase4ProgressByTurn={{}}
        lastTurnId={t1.id}
        initialDeleteConfirm={true}
        onToggleCognition={vi.fn()}
        onToggleMemories={vi.fn()}
        onCheckoutTurn={vi.fn()}
        onStartEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onSwipeRegenerate={vi.fn()}
        onDeleteLast={vi.fn()}
        onOpenAgentModal={vi.fn()}
      />
    );
    expect(armedHtml).toContain("turn-delete-btn--confirm");
    expect(armedHtml).toContain("turn-delete-confirm-label");
    expect(armedHtml).toContain(">Confirm?<");
    expect(armedHtml).toContain(
      'aria-label="Confirm delete last turn and unfollowed swipes"'
    );
  });

  it("supports Game Mechanics Prev/Next pager, Codex mobile list/detail panes, and conditional footer hiding", () => {
    const firstTopic = ORDERED_MECHANICS_ARTICLES[0];
    const middleTopic = ORDERED_MECHANICS_ARTICLES[1];
    const lastTopic =
      ORDERED_MECHANICS_ARTICLES[ORDERED_MECHANICS_ARTICLES.length - 1];

    expect(getAdjacentMechanicsTopics(firstTopic.id).prev).toBeNull();
    expect(getAdjacentMechanicsTopics(firstTopic.id).next?.id).toBe(middleTopic.id);
    expect(getAdjacentMechanicsTopics(middleTopic.id).prev?.id).toBe(firstTopic.id);
    expect(getAdjacentMechanicsTopics(middleTopic.id).next).not.toBeNull();
    expect(getAdjacentMechanicsTopics(lastTopic.id).next).toBeNull();

    const pagerHtml = renderToStaticMarkup(
      <CodexMechanicsDetail article={middleTopic} onSelectTopic={vi.fn()} />
    );
    expect(pagerHtml).toContain("codex-mechanics-pager");
    expect(pagerHtml).toContain('<span class="codex-mechanics-pager-dir">Previous</span>');
    expect(pagerHtml).toContain('<span class="codex-mechanics-pager-dir">Next</span>');

    const listPaneHtml = renderToStaticMarkup(
      <WorldCodexTab
        worldId={WORLD_FIXTURE.id}
        isActive={true}
        isCampaignMode={true}
        loreNodes={WORLD_FIXTURE.lore_nodes}
        pendingWorldLoreTagDrafts={{}}
        containers={WORLD_FIXTURE.containers ?? []}
        locations={WORLD_FIXTURE.locations}
        initialSection="mechanics"
        onUpdateLoreNodes={vi.fn()}
        onUpdatePendingTagDrafts={vi.fn()}
        onMarkDirty={vi.fn()}
        onOpenOnMap={vi.fn()}
      />
    );
    expect(listPaneHtml).toContain("codex-two-pane--mobile-list");
    expect(listPaneHtml).toContain("codex-left-pane");
    expect(listPaneHtml).toContain("codex-right-pane");

    const detailPaneHtml = renderToStaticMarkup(
      <WorldCodexTab
        worldId={WORLD_FIXTURE.id}
        isActive={true}
        isCampaignMode={true}
        loreNodes={WORLD_FIXTURE.lore_nodes}
        pendingWorldLoreTagDrafts={{}}
        containers={WORLD_FIXTURE.containers ?? []}
        locations={WORLD_FIXTURE.locations}
        initialSection="mechanics"
        initialMobilePane="detail"
        onUpdateLoreNodes={vi.fn()}
        onUpdatePendingTagDrafts={vi.fn()}
        onMarkDirty={vi.fn()}
        onOpenOnMap={vi.fn()}
      />
    );
    expect(detailPaneHtml).toContain("codex-two-pane--mobile-detail");
    expect(detailPaneHtml).toContain("codex-mobile-detail-bar");
    expect(detailPaneHtml).toContain("codex-mobile-topic-picker-btn");

    const campaignCodexModalHtml = renderToStaticMarkup(
      <WorldInspectorModal
        world={WORLD_FIXTURE}
        mode="campaign"
        initialTab="codex"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    expect(campaignCodexModalHtml).toContain("modal-footer--hide-mobile-readonly");

    const studioBaseModalHtml = renderToStaticMarkup(
      <WorldInspectorModal
        world={WORLD_FIXTURE}
        mode="inspector"
        initialTab="base"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    expect(studioBaseModalHtml).toContain("world-inspector-base-grid");
    expect(studioBaseModalHtml).not.toContain("modal-footer--hide-mobile-readonly");

    expect(getMechanicsArticle("timelines-branching")?.scales?.some((s) =>
      s.meaning.includes("‹ v#/N ›")
    )).toBe(true);
  });

  it("handles stage clock date split, mobile default-collapsed cognition, jump-to-latest, and coarse-pointer Enter", () => {
    expect(splitWorldClockDisplay("2094-11-14 23:15")).toEqual({
      prefix: "2094-11-14 23",
      datePrefix: "2094-11-14 ",
      hourDigits: "23",
      colon: ":",
      suffix: "15",
    });

    const t0 = makeTurn("t-0", 0, { raw_prose: "Intro." });
    const t1 = makeTurn("t-1", 1, {
      cognition: {
        recall: "UNIQUE_MOBILE_RECALL_TEXT",
        feeling: "focused",
        want: "Scan",
        plan: "Wait",
        valence: 0,
        arousal: 0.2,
      },
    });
    const bundle = makeBundle([t0, t1]);

    const desktopStageHtml = renderToStaticMarkup(
      <ChatStage
        bundle={bundle}
        world={WORLD_FIXTURE}
        character={CHAR_MIRA}
        isStreaming={false}
        liveStream={null}
        isMobileLayout={false}
        onSendTurn={vi.fn()}
        onCheckoutTurn={vi.fn()}
      />
    );
    expect(desktopStageHtml).toContain("stage-clock-date");
    expect(desktopStageHtml).toContain("UNIQUE_MOBILE_RECALL_TEXT");

    const mobileStageHtml = renderToStaticMarkup(
      <ChatStage
        bundle={bundle}
        world={WORLD_FIXTURE}
        character={CHAR_MIRA}
        isStreaming={false}
        liveStream={null}
        isMobileLayout={true}
        onSendTurn={vi.fn()}
        onCheckoutTurn={vi.fn()}
      />
    );
    expect(mobileStageHtml).toContain("stage-clock-date");
    expect(mobileStageHtml).not.toContain("UNIQUE_MOBILE_RECALL_TEXT");

    expect(
      isTurnFeedScrolledAwayFromBottom({
        scrollHeight: 1200,
        scrollTop: 1000,
        clientHeight: 180,
      })
    ).toBe(false);
    expect(
      isTurnFeedScrolledAwayFromBottom({
        scrollHeight: 1200,
        scrollTop: 700,
        clientHeight: 300,
      })
    ).toBe(true);

    expect(shouldEnterSubmitComposer({ key: "Enter", shiftKey: false }, false)).toBe(true);
    expect(shouldEnterSubmitComposer({ key: "Enter", shiftKey: true }, false)).toBe(false);
    expect(shouldEnterSubmitComposer({ key: "Enter", shiftKey: false }, true)).toBe(false);
    expect(
      shouldEnterSubmitComposer({ key: "Enter", shiftKey: false, ctrlKey: true }, true)
    ).toBe(true);
    expect(
      shouldEnterSubmitComposer({ key: "Enter", shiftKey: false, metaKey: true }, true)
    ).toBe(true);
  });

  it("renders mobile responsive labels/layouts in ChatComposer, DirectorChoicesDrawer, and GmTalkDrawer", () => {
    const composerHtml = renderToStaticMarkup(
      <ChatComposer {...makeComposerProps()} />
    );
    expect(composerHtml).toContain("composer-action-label");
    expect(composerHtml).toContain("composer-action-caret");
    expect(composerHtml).toContain('aria-label="GM Talk"');
    expect(composerHtml).toContain('aria-label="Narrator actions"');
    expect(composerHtml).toContain('aria-label="Exits (1)"');
    expect(composerHtml).toContain('aria-label="Director Choices"');

    const choicesHtml = renderToStaticMarkup(
      <DirectorChoicesDrawer
        presentCharacters={[CHAR_MIRA]}
        stagedChoices={{
          [CHAR_MIRA.id]: {
            character_id: CHAR_MIRA.id,
            gate_difficulty_class: 12,
            options: [{ id: "opt-1", label: "Slip past the guard", gate: "any" }],
          },
        }}
        activeChoiceCharId={CHAR_MIRA.id}
        setActiveChoiceCharId={vi.fn()}
        activeCharRecord={CHAR_MIRA}
        totalStagedOptionsCount={1}
        diceMode="auto"
        choicePreview={null}
        onClearAll={vi.fn()}
        onClearChar={vi.fn()}
        onSetDC={vi.fn()}
        onAddOption={vi.fn()}
        onUpdateOption={vi.fn()}
        onRemoveOption={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(choicesHtml).toContain('aria-label="Close Director Choices"');
    expect(choicesHtml).toContain("choices-dc-input");
    expect(choicesHtml).toContain("choices-option-main");
    expect(choicesHtml).toContain("choices-option-meta");

    const gmHtml = renderToStaticMarkup(
      <GmTalkDrawer
        campaignTitle="Kowloon Run"
        worldName="Sunken Reach"
        unlockLore={true}
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
    expect(gmHtml).toContain("gm-spoiler-pill-detail");
    expect(gmHtml).toContain("gm-clear-btn-label");
  });

  it("supports Branch Graph pinch zoom/pan math, mini-map touch hit targets, and edge-directed drawer swipe helpers", () => {
    const startPan = { x: 40, y: 20 };
    const startZoom = 1;
    const stageRect = { left: 100, top: 50 };
    const startCenter = { x: 240, y: 170 }; // pivot=(140,120) -> world=(100,100)
    const zoomed = computeBranchPinchViewport({
      startZoom,
      startPan,
      startCenter,
      startDistance: 100,
      currentCenter: { x: 260, y: 190 }, // pivot=(160,140)
      currentDistance: 150, // ratio 1.5 -> zoom 1.5
      stageRect,
    });
    expect(zoomed.zoom).toBe(1.5);
    expect(zoomed.pan.x).toBeCloseTo(160 - 100 * 1.5, 5);
    expect(zoomed.pan.y).toBeCloseTo(140 - 100 * 1.5, 5);

    const clampedMax = computeBranchPinchViewport({
      startZoom: 1.5,
      startPan: { x: 0, y: 0 },
      startCenter: { x: 100, y: 50 },
      startDistance: 50,
      currentCenter: { x: 100, y: 50 },
      currentDistance: 500,
      stageRect,
    });
    expect(clampedMax.zoom).toBe(MAX_GRAPH_ZOOM);

    const clampedMin = computeBranchPinchViewport({
      startZoom: 0.4,
      startPan: { x: 0, y: 0 },
      startCenter: { x: 100, y: 50 },
      startDistance: 400,
      currentCenter: { x: 100, y: 50 },
      currentDistance: 40,
      stageRect,
    });
    expect(clampedMin.zoom).toBe(MIN_GRAPH_ZOOM);

    const t0 = makeTurn("t-0", 0, { raw_prose: "Intro." });
    const miniBundle = makeBundle([t0]);
    const miniMapHtml = renderToStaticMarkup(
      <InspectorLocationCard
        bundle={miniBundle}
        activeLoc={LOC_HUB}
        selectedLocId={LOC_HUB.id}
        setSelectedLocId={vi.fn()}
        selectedLocation={LOC_HUB}
        selectedNeighbor={undefined}
        immediateNeighbors={[{ ...NEIGHBOR_ALLEY, slot: "N" }]}
        miniMapCenter={{ x: 145, y: 112 }}
        miniMapCoords={{
          [LOC_HUB.id]: { x: 145, y: 112 },
          [LOC_ALLEY.id]: { x: 145, y: 38, slot: "N" },
        }}
        miniDynamicPortalIds={new Set()}
        containerMap={new Map()}
        activeBreadcrumbChain={[]}
        showExits={false}
        setShowExits={vi.fn()}
        isOverriding={false}
        handleOverrideClick={vi.fn()}
        handleOpenFullMap={vi.fn()}
      />
    );
    expect(miniMapHtml).toContain('r="22"');
    expect(miniMapHtml).toContain("minimap-node-hit-target");

    // Left drawer dismisses left (negative dx), locks out opposite-direction swipe
    expect(computeDrawerSwipeOffset("left", -36, 4, "none")).toEqual({
      lockedAxis: "horizontal",
      offsetPx: -36,
    });
    expect(computeDrawerSwipeOffset("left", 36, 4, "none")).toEqual({
      lockedAxis: "vertical",
      offsetPx: 0,
    });
    // Vertical scroll locks vertical cleanly
    expect(computeDrawerSwipeOffset("right", 6, 20, "none")).toEqual({
      lockedAxis: "vertical",
      offsetPx: 0,
    });
    // Right drawer dismisses right (positive dx)
    expect(computeDrawerSwipeOffset("right", 48, 5, "none")).toEqual({
      lockedAxis: "horizontal",
      offsetPx: 48,
    });

    expect(shouldDismissDrawerSwipe("left", -DRAWER_SWIPE_DISMISS_PX, 500)).toBe(true);
    expect(shouldDismissDrawerSwipe("left", -20, 40)).toBe(false);
    expect(shouldDismissDrawerSwipe("left", -36, 60)).toBe(true);
    expect(shouldDismissDrawerSwipe("right", DRAWER_SWIPE_DISMISS_PX, 400)).toBe(true);
    expect(shouldDismissDrawerSwipe("right", -DRAWER_SWIPE_DISMISS_PX, 50)).toBe(false);
  });
});
