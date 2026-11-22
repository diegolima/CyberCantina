import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  CampaignStateBundle,
  CharacterRecord,
  CharacterStateSnapshot,
  EpisodicChunkRecord,
  LocationNode,
  TurnNodeRecord,
  WorldStateSnapshot,
} from "../../types";
import {
  buildBranchGraphModel,
  findContainingEpisodeId,
} from "../story/branchGraphLayout";
import {
  buildStoryBookmarkItems,
  filterStoryBookmarkItems,
} from "../story/storyBookmarks";
import { BranchGraphCanvas } from "../story/BranchGraphCanvas";
import { StoryModal } from "../story/StoryModal";
import { TurnCard } from "../chat/TurnCard";
import { TurnBookmarkNoteRow } from "../chat/TurnBookmarkNoteRow";

const LOC_BAR: LocationNode = {
  id: "loc-bar",
  world_id: "w-1",
  name: "Neon Cantina",
  summary: "Chrome bar hub.",
  description: "Rain-streaked chrome counter.",
  environmental_tags: ["hub"],
  is_starting_location: true,
  lore_nodes: [],
  ui_x: 100,
  ui_y: 100,
  is_visited: true,
};

const CHAR_KIRA: CharacterRecord = {
  id: "char-kira",
  version: 1,
  world_id: "w-1",
  name: "Kira Vance",
  tagline: "Ex-corp fixer",
  physical_appearance: "Chrome-trimmed trenchcoat",
  core_persona: "Fixer",
  communication_style: ["dry"],
  quirks_flaws: [],
  moral_code: ["Pragmatic"],
  baseline_psyche: {
    mood_label: "alert",
    valence: 0.1,
    arousal: 0.3,
    core_drive: "Close the deal",
    core_fear: "Betrayal",
    default_want: "Read the room",
    default_plan: "Watch the door",
  },
  voice_anchors: [],
  equipped: [],
  inventory: [],
  memory_shards: [],
  initial_message: "",
  tags: [],
  creator: "test",
  creator_notes: "",
  portraits: {},
  gallery: [],
  created_at: "2026-01-01T00:00:00Z",
};

function makeTurn(opts: {
  id: string;
  parentId: string | null;
  depth: number;
  userMessage?: string;
  prose?: string;
  actorId?: string;
  notableSummary?: string | null;
  isBookmarked?: boolean;
  userNote?: string | null;
  createdAt?: string;
}): TurnNodeRecord {
  const ws: WorldStateSnapshot = {
    turn_id: opts.id,
    world_timestamp: `Day 1 20:${String(opts.depth).padStart(2, "0")}`,
    active_location_id: LOC_BAR.id,
    scene_flags: [],
    campaign_elapsed_minutes: opts.depth * 5,
    visited_location_ids: [LOC_BAR.id],
    parties: [],
  };
  const cs: CharacterStateSnapshot = {
    turn_id: opts.id,
    character_id: CHAR_KIRA.id,
    current_location_id: LOC_BAR.id,
    mood_label: "alert",
    valence: 0.1,
    arousal: 0.3,
    active_want: "close the deal",
    active_plan: "watch the door",
    relationship_notes: {},
    equipped: [],
    inventory: [],
  };
  return {
    id: opts.id,
    campaign_id: "camp-1",
    parent_turn_id: opts.parentId,
    depth_index: opts.depth,
    user_message: opts.userMessage ?? (opts.depth === 0 ? "" : `Prompt ${opts.id}`),
    actor_id: opts.actorId ?? CHAR_KIRA.id,
    raw_prose: opts.prose ?? `Narrative prose for ${opts.id}.`,
    cognition: {
      recall: "",
      feeling: "alert",
      want: "close the deal",
      plan: "watch the door",
      valence: 0.1,
      arousal: 0.3,
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
      active_speaker_id: opts.actorId ?? CHAR_KIRA.id,
      speaker_order: [CHAR_KIRA.id],
    },
    post_turn:
      opts.notableSummary !== undefined
        ? {
            elapsed_minutes: 5,
            transition_type: "stay",
            notable_event_summary: opts.notableSummary,
            scene_flags_updated: [],
          }
        : null,
    world_snapshot: ws,
    character_state: cs,
    character_states: { [CHAR_KIRA.id]: cs },
    recalled_items: [],
    is_bookmarked: opts.isBookmarked ?? false,
    user_note: opts.userNote ?? null,
    created_at:
      opts.createdAt ?? `2026-01-01T00:${String(opts.depth).padStart(2, "0")}:00Z`,
  };
}

function makeBundle(
  allTurns: TurnNodeRecord[],
  activeBranchTurns: TurnNodeRecord[],
  episodicChunks: EpisodicChunkRecord[] = [],
  allEpisodicChunks?: EpisodicChunkRecord[]
): CampaignStateBundle {
  const leaf = activeBranchTurns[activeBranchTurns.length - 1];
  return {
    campaign: {
      id: "camp-1",
      name: "Operation Glass Horizon",
      world_id: "w-1",
      character_id: CHAR_KIRA.id,
      participant_character_ids: [CHAR_KIRA.id],
      active_leaf_turn_id: leaf.id,
      created_at: "2026-01-01T00:00:00Z",
    },
    active_branch_turns: activeBranchTurns,
    all_turn_nodes: allTurns,
    current_world_snapshot: leaf.world_snapshot,
    current_character_state: leaf.character_state,
    character_states: leaf.character_states,
    character_records: { [CHAR_KIRA.id]: CHAR_KIRA },
    present_character_ids: [CHAR_KIRA.id],
    active_location: LOC_BAR,
    neighbor_locations: [],
    visible_locations: [LOC_BAR],
    visible_edges: [],
    episodic_chunks: episodicChunks,
    all_episodic_chunks: allEpisodicChunks ?? episodicChunks,
  };
}

const noop = () => {};

describe("Turn Bookmarks, Personal Notes & Story Integration (v0.29.0)", () => {
  it("exempts bookmarked swipes from hiddenSwipes, applies user_note -> notable_event -> fallback priority, and counts bookmarks per episode", () => {
    const t0 = makeTurn({ id: "t0", parentId: null, depth: 0 });
    const t1 = makeTurn({
      id: "t1",
      parentId: "t0",
      depth: 1,
      userMessage: "Talk to Kira.",
      notableSummary: "Kira agreed to meet.",
      isBookmarked: true,
      userNote: "Great opening banter",
    });
    const t2a = makeTurn({
      id: "t2a",
      parentId: "t1",
      depth: 2,
      userMessage: "Ask about the vault.",
      isBookmarked: true,
      userNote: "Bookmarked earlier swipe",
      createdAt: "2026-01-01T00:02:00Z",
    });
    const t2b = makeTurn({
      id: "t2b",
      parentId: "t1",
      depth: 2,
      userMessage: "Ask about the vault.",
      notableSummary: "Kira revealed the vault code.",
      isBookmarked: false,
      userNote: "Retained note while unbookmarked",
      createdAt: "2026-01-01T00:03:00Z",
    });
    const t3 = makeTurn({
      id: "t3",
      parentId: "t2b",
      depth: 3,
      userMessage: "Enter the vault.",
    });

    const epChunk: EpisodicChunkRecord = {
      id: "ep-1",
      campaign_id: "camp-1",
      start_turn_depth: 1,
      end_turn_depth: 2,
      leaf_turn_id: "t2b",
      title: "Vault Deal",
      synopsis_text: "Kira gave up the vault code.",
      summary_text: "Full summary.",
      created_at: "2026-01-01T00:04:00Z",
    };

    const model = buildBranchGraphModel({
      allTurns: [t0, t1, t2a, t2b, t3],
      activeBranchTurns: [t0, t1, t2b, t3],
      activeLeafId: "t3",
      episodicChunks: [epChunk],
      expandedEpisodeIds: new Set<string>(), // keep episode collapsed to test pseudo-node counts
    });

    // t2a must NOT be collapsed into t2b.hiddenSwipes because it is bookmarked
    expect(model.totalHiddenSwipes).toBe(0);
    expect(model.nodeById["t2a"]).toBeDefined();
    expect(model.nodeById["t2a"].isBookmarked).toBe(true);
    expect(model.nodeById["t2a"].description).toBe("Bookmarked earlier swipe");
    expect(model.nodeById["t2a"].descriptionSource).toBe("user_note");

    // Collapsed episode [t1, t2b] contains 1 bookmarked turn (t1); t2b is unbookmarked so its retained note is ignored
    const ep = model.episodes[0];
    expect(ep.bookmarkCount).toBe(1);
    expect(ep.bookmarkedTurnIds).toEqual(["t1"]);

    // Expanding episode verifies description priority on t1 (user_note beats notable) and t2b (notable beats unbookmarked retained user_note)
    const expandedModel = buildBranchGraphModel({
      allTurns: [t0, t1, t2a, t2b, t3],
      activeBranchTurns: [t0, t1, t2b, t3],
      activeLeafId: "t3",
      episodicChunks: [epChunk],
      expandedEpisodeIds: new Set<string>([ep.id]),
    });
    expect(expandedModel.nodeById["t1"].description).toBe("Great opening banter");
    expect(expandedModel.nodeById["t1"].descriptionSource).toBe("user_note");
    expect(expandedModel.nodeById["t2b"].description).toBe("Kira revealed the vault code.");
    expect(expandedModel.nodeById["t2b"].descriptionSource).toBe("notable_event");
  });

  it("sorts story bookmarks by turn depth then swipe order and live-filters by note keywords", () => {
    const t0 = makeTurn({ id: "t0", parentId: null, depth: 0, isBookmarked: true });
    const t1a = makeTurn({
      id: "t1a",
      parentId: "t0",
      depth: 1,
      userMessage: "Open the door.",
      isBookmarked: true,
      userNote: "Vault key hidden inside locker",
      createdAt: "2026-01-01T00:01:00Z",
    });
    const t1b = makeTurn({
      id: "t1b",
      parentId: "t0",
      depth: 1,
      userMessage: "Open the door.",
      isBookmarked: true,
      userNote: "Alternative confrontation with guard",
      createdAt: "2026-01-01T00:02:00Z",
    });
    const t2Arr = makeTurn({
      id: "t2arr",
      parentId: "t1b",
      depth: 2,
      actorId: "__arrival__",
      isBookmarked: true,
    });
    const t3 = makeTurn({
      id: "t3",
      parentId: "t2arr",
      depth: 3,
      isBookmarked: true,
      userNote: "Secret vault cipher decoded",
    });

    const items = buildStoryBookmarkItems(
      [t3, t1b, t0, t2Arr, t1a],
      [t0, t1b, t2Arr, t3],
      { [LOC_BAR.id]: LOC_BAR.name }
    );

    // Turn #0 and __arrival__ are excluded; order is t1a (v1), t1b (v2), t3
    expect(items.map((i) => i.turn.id)).toEqual(["t1a", "t1b", "t3"]);
    expect(items[0].swipeIndex).toBe(1);
    expect(items[0].isOnActiveTimeline).toBe(false);
    expect(items[1].swipeIndex).toBe(2);
    expect(items[1].isOnActiveTimeline).toBe(true);

    // Multi-token case-insensitive filtering strictly against user_note
    expect(filterStoryBookmarkItems(items, "").length).toBe(3);
    expect(filterStoryBookmarkItems(items, "VAULT locker").map((i) => i.turn.id)).toEqual(["t1a"]);
    expect(filterStoryBookmarkItems(items, "vault").map((i) => i.turn.id)).toEqual(["t1a", "t3"]);
    expect(filterStoryBookmarkItems(items, "missingword")).toEqual([]);
  });

  it("renders TurnCard top-left bookmark slot (omitted on Turn #0) and purple note below notable_event_summary", () => {
    const t0 = makeTurn({ id: "t0", parentId: null, depth: 0 });
    const t1 = makeTurn({
      id: "t1",
      parentId: "t0",
      depth: 1,
      notableSummary: "Kira handed over the access chip.",
      isBookmarked: true,
      userNote: "Favorite betrayal foreshadowing moment",
    });
    const t2Unbookmarked = makeTurn({
      id: "t2",
      parentId: "t1",
      depth: 2,
      isBookmarked: false,
      userNote: "Hidden while unbookmarked",
    });
    const bundle = makeBundle([t0, t1, t2Unbookmarked], [t0, t1, t2Unbookmarked]);

    const htmlRoot = renderToStaticMarkup(
      <TurnCard
        turn={t0}
        turnIdx={0}
        bundle={bundle}
        character={CHAR_KIRA}
        allCampaignCharacters={[CHAR_KIRA]}
        presentCharacterIds={[CHAR_KIRA.id]}
        siblings={[t0]}
        isBusy={false}
        isDeletingTurn={false}
        isEditingThisTurn={false}
        hasActiveEditingTurn={false}
        hasDeleteLastHandler={false}
        cogOpen={false}
        memOpen={false}
        phase4ProgressByTurn={{}}
        onToggleCognition={noop}
        onToggleMemories={noop}
        onCheckoutTurn={noop}
        onStartEdit={noop}
        onCancelEdit={noop}
        onSwipeRegenerate={noop}
        onDeleteLast={noop}
        onOpenAgentModal={noop}
        onUpdateTurnBookmark={async () => null}
      />
    );
    expect(htmlRoot).not.toContain("data-turn-bookmark-toggle");

    const htmlTurn1 = renderToStaticMarkup(
      <TurnCard
        turn={t1}
        turnIdx={1}
        bundle={bundle}
        character={CHAR_KIRA}
        allCampaignCharacters={[CHAR_KIRA]}
        presentCharacterIds={[CHAR_KIRA.id]}
        siblings={[t1]}
        isBusy={false}
        isDeletingTurn={false}
        isEditingThisTurn={false}
        hasActiveEditingTurn={false}
        hasDeleteLastHandler={false}
        cogOpen={false}
        memOpen={false}
        phase4ProgressByTurn={{}}
        onToggleCognition={noop}
        onToggleMemories={noop}
        onCheckoutTurn={noop}
        onStartEdit={noop}
        onCancelEdit={noop}
        onSwipeRegenerate={noop}
        onDeleteLast={noop}
        onOpenAgentModal={noop}
        onUpdateTurnBookmark={async () => null}
      />
    );
    expect(htmlTurn1).toContain('data-turn-bookmark-toggle="t1"');
    expect(htmlTurn1).toContain("★ Kira handed over the access chip.");
    expect(htmlTurn1).toContain("Favorite betrayal foreshadowing moment");
    // Bookmark note row renders below notable_event_summary
    expect(htmlTurn1.indexOf("★ Kira handed over the access chip.")).toBeLessThan(
      htmlTurn1.indexOf("Favorite betrayal foreshadowing moment")
    );

    const htmlTurn2 = renderToStaticMarkup(
      <TurnCard
        turn={t2Unbookmarked}
        turnIdx={2}
        bundle={bundle}
        character={CHAR_KIRA}
        allCampaignCharacters={[CHAR_KIRA]}
        presentCharacterIds={[CHAR_KIRA.id]}
        siblings={[t2Unbookmarked]}
        isBusy={false}
        isDeletingTurn={false}
        isEditingThisTurn={false}
        hasActiveEditingTurn={false}
        hasDeleteLastHandler={false}
        cogOpen={false}
        memOpen={false}
        phase4ProgressByTurn={{}}
        onToggleCognition={noop}
        onToggleMemories={noop}
        onCheckoutTurn={noop}
        onStartEdit={noop}
        onCancelEdit={noop}
        onSwipeRegenerate={noop}
        onDeleteLast={noop}
        onOpenAgentModal={noop}
        onUpdateTurnBookmark={async () => null}
      />
    );
    expect(htmlTurn2).toContain('data-turn-bookmark-toggle="t2"');
    expect(htmlTurn2).not.toContain("Hidden while unbookmarked");

    const editorHtml = renderToStaticMarkup(
      <TurnBookmarkNoteRow
        turn={t1}
        initialEditing={true}
        onSaveNote={async () => {}}
        onSummarizeTurn={async () => "Summary"}
      />
    );
    expect(editorHtml).toContain("Summarize turn with Clerk");
    expect(editorHtml).toContain("magic-wand-icon-btn accent-violet");
  });

  it("renders StoryModal Bookmarks tab and BranchGraphCanvas bookmark badges + synchronous episode auto-expansion", () => {
    const t0 = makeTurn({ id: "t0", parentId: null, depth: 0 });
    const t1 = makeTurn({
      id: "t1",
      parentId: "t0",
      depth: 1,
      isBookmarked: true,
      userNote: "Key alternate branch note",
    });
    const t2 = makeTurn({ id: "t2", parentId: "t1", depth: 2 });
    const tAlt = makeTurn({ id: "tAlt", parentId: "t0", depth: 1 });
    const tAlt2 = makeTurn({ id: "tAlt2", parentId: "tAlt", depth: 2 });

    const altEpChunk: EpisodicChunkRecord = {
      id: "ep-bm",
      campaign_id: "camp-1",
      start_turn_depth: 1,
      end_turn_depth: 2,
      leaf_turn_id: "t2",
      title: "Branch One",
      synopsis_text: "Branch one summary.",
      summary_text: "Branch one full summary.",
      created_at: "2026-01-01T00:05:00Z",
    };

    const bundle = makeBundle(
      [t0, t1, t2, tAlt, tAlt2],
      [t0, tAlt, tAlt2],
      [],
      [altEpChunk]
    );

    // 1. StoryModal Bookmarks tab
    const bookmarksTabHtml = renderToStaticMarkup(
      <StoryModal
        isOpen={true}
        initialTab="bookmarks"
        onClose={noop}
        bundle={bundle}
        onZoomToTurn={noop}
        onSwitchTimeline={noop}
        onBranchFromTurn={noop}
      />
    );
    expect(bookmarksTabHtml).toContain("Bookmarks");
    expect(bookmarksTabHtml).toContain('placeholder="Filter bookmarks by note keywords..."');
    expect(bookmarksTabHtml).toContain("Key alternate branch note");
    expect(bookmarksTabHtml).toContain("Alternate Branch");
    expect(bookmarksTabHtml).toContain("Focus in Timelines");

    // 2. BranchGraphCanvas collapsed episode shows bookmark count badge
    const collapsedGraphHtml = renderToStaticMarkup(
      <BranchGraphCanvas
        bundle={bundle}
        onZoomToTurn={noop}
        onSwitchTimeline={noop}
        onBranchFromTurn={noop}
      />
    );
    expect(collapsedGraphHtml).toContain('data-episode-bookmarks="1"');
    expect(collapsedGraphHtml).toContain('data-episode-bookmark-badge="episode:ep-bm"');

    // 3. BranchGraphCanvas with initialSelectedNodeId="t1" auto-expands episode, renders bookmark icon, and selects t1
    const containingEpId = findContainingEpisodeId(
      {
        allTurns: bundle.all_turn_nodes,
        activeBranchTurns: bundle.active_branch_turns,
        activeLeafId: bundle.campaign.active_leaf_turn_id,
        episodicChunks: bundle.episodic_chunks,
        allEpisodicChunks: bundle.all_episodic_chunks,
      },
      "t1"
    );
    expect(containingEpId).toBe("episode:ep-bm");

    const focusedGraphHtml = renderToStaticMarkup(
      <BranchGraphCanvas
        bundle={bundle}
        initialSelectedNodeId="t1"
        focusSelectedOnMount={true}
        onZoomToTurn={noop}
        onSwitchTimeline={noop}
        onBranchFromTurn={noop}
      />
    );
    expect(focusedGraphHtml).toContain('data-selected-turn-id="t1"');
    expect(focusedGraphHtml).toContain('data-node-bookmark-icon="t1"');
    expect(focusedGraphHtml).toContain("Key alternate branch note");
    expect(focusedGraphHtml).not.toContain("★ Key alternate branch note");
  });
});
