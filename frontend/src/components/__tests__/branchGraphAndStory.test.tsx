import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  CampaignStateBundle,
  CharacterRecord,
  CharacterStateSnapshot,
  EpisodicChunkRecord,
  LocationNode,
  TurnNodeRecord,
  UserProfile,
  WorldRecord,
  WorldStateSnapshot,
} from "../../types";
import {
  buildBranchGraphModel,
  computeAncestorPath,
  computeCenterNodeViewport,
  computeFitGraphViewport,
} from "../story/branchGraphLayout";
import { StoryModal } from "../story/StoryModal";
import { AppSidebar } from "../AppSidebar";
import { LiveInspector } from "../LiveInspector";
import { ChatStage } from "../ChatStage";
import { TurnCard } from "../chat/TurnCard";
import { StandaloneArrivalCard } from "../chat/StandaloneArrivalCard";

const USER: UserProfile = {
  id: "user-1",
  username: "tester",
  display_name: "Tester",
  role: "admin",
  has_password: true,
  passkeys: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

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

const LOC_ALLEY: LocationNode = {
  id: "loc-alley",
  world_id: "w-1",
  name: "Cargo Alley",
  summary: "Steaming side alley.",
  description: "Steaming vents and flickering signs.",
  environmental_tags: ["alley"],
  is_starting_location: false,
  lore_nodes: [],
  ui_x: 240,
  ui_y: 100,
  is_visited: true,
};

const WORLD: WorldRecord = {
  id: "w-1",
  name: "Night Sector",
  global_rules: {
    genre: "cyberpunk",
    tone: "noir",
    setting_overview: "Neon rain city.",
    tech_or_magic_rules: "Street chrome.",
    starting_timestamp: "Day 1 20:00",
  },
  locations: [LOC_BAR, LOC_ALLEY],
  edges: [],
  lore_nodes: [],
  created_at: "2026-01-01T00:00:00Z",
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
  locationId?: string;
  notableSummary?: string | null;
  timestamp?: string;
}): TurnNodeRecord {
  const locId = opts.locationId ?? LOC_BAR.id;
  const ws: WorldStateSnapshot = {
    turn_id: opts.id,
    world_timestamp: opts.timestamp ?? `Day 1 20:${String(opts.depth).padStart(2, "0")}`,
    active_location_id: locId,
    scene_flags: [],
    campaign_elapsed_minutes: opts.depth * 5,
    visited_location_ids: [LOC_BAR.id, locId],
    parties: [],
  };
  const cs: CharacterStateSnapshot = {
    turn_id: opts.id,
    character_id: CHAR_KIRA.id,
    current_location_id: locId,
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
    created_at: `2026-01-01T00:${String(opts.depth).padStart(2, "0")}:00Z`,
  };
}

function makeBundle(
  allTurns: TurnNodeRecord[],
  activeBranchTurns: TurnNodeRecord[],
  episodicChunks: EpisodicChunkRecord[] = []
): CampaignStateBundle {
  const leaf = activeBranchTurns[activeBranchTurns.length - 1];
  return {
    campaign: {
      id: "camp-1",
      name: "Operation Glass Horizon",
      world_id: WORLD.id,
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
    visible_locations: [LOC_BAR, LOC_ALLEY],
    visible_edges: [],
    episodic_chunks: episodicChunks,
  };
}

describe("Branch Graph layout & filtering (branchGraphLayout.ts)", () => {
  it("hides unfollowed same-prompt swipes by default, expands them on demand, and reveals a swipe if branched/active", () => {
    const t0 = makeTurn({ id: "t0", parentId: null, depth: 0 });
    const t1 = makeTurn({ id: "t1", parentId: "t0", depth: 1, userMessage: "Scan the bar." });
    const sharedPrompt = "Ask Kira about the datashard.";
    const t2a = makeTurn({ id: "t2a", parentId: "t1", depth: 2, userMessage: sharedPrompt });
    const t2b = makeTurn({ id: "t2b", parentId: "t1", depth: 2, userMessage: sharedPrompt });
    const t2c = makeTurn({ id: "t2c", parentId: "t1", depth: 2, userMessage: sharedPrompt });
    const t2d = makeTurn({
      id: "t2d",
      parentId: "t1",
      depth: 2,
      userMessage: sharedPrompt,
      notableSummary: "Kira reveals the vault cipher",
    });
    const t3 = makeTurn({ id: "t3", parentId: "t2d", depth: 3, userMessage: "Head to the alley." });
    const allTurns = [t0, t1, t2a, t2b, t2c, t2d, t3];

    // 1. Default view: t2a-t2c hidden under t2d (+3 swipes), t2d -> t3 visible
    const model = buildBranchGraphModel({
      allTurns,
      activeBranchTurns: [t0, t1, t2d, t3],
      activeLeafId: "t3",
      locationNamesById: { [LOC_BAR.id]: LOC_BAR.name },
    });

    expect(model.nodes.map((n) => n.id)).toEqual(["t0", "t1", "t2d", "t3"]);
    expect(model.totalHiddenSwipes).toBe(3);
    expect(model.branchTipCount).toBe(1);
    expect(model.nodeById["t2d"].hiddenSwipes.map((s) => s.id)).toEqual(["t2a", "t2b", "t2c"]);
    expect(model.nodeById["t2d"].hasNotableSummary).toBe(true);
    expect(model.nodeById["t2d"].description).toBe("Kira reveals the vault cipher");
    expect(model.nodeById["t0"].description).toBe("[Opening Scene]");

    // 2. Expanding t2d reveals t2a-t2c as swipe siblings while t2d -> t3 remains anchored to t2d
    const expanded = buildBranchGraphModel({
      allTurns,
      activeBranchTurns: [t0, t1, t2d, t3],
      activeLeafId: "t3",
      expandedSwipeAnchorIds: new Set(["t2d"]),
    });
    expect(expanded.nodes.map((n) => n.id)).toEqual(["t0", "t1", "t2d", "t3", "t2a", "t2b", "t2c"]);
    expect(expanded.nodeById["t2a"].kind).toBe("swipe");
    expect(expanded.nodeById["t2a"].isExpandedSwipe).toBe(true);
    expect(expanded.edges.some((e) => e.fromId === "t2d" && e.toId === "t3")).toBe(true);
    expect(expanded.edges.some((e) => e.fromId === "t1" && e.toId === "t2a" && e.isExpandedSwipe)).toBe(true);

    // 3. Switching to t2a on the turn card and branching makes t2a appear on the graph immediately
    const branchedOn2a = buildBranchGraphModel({
      allTurns,
      activeBranchTurns: [t0, t1, t2a],
      activeLeafId: "t2a",
    });
    expect(branchedOn2a.nodeById["t2a"]).toBeDefined();
    expect(branchedOn2a.nodeById["t2a"].isActiveLeaf).toBe(true);
    expect(branchedOn2a.nodeById["t2d"]).toBeDefined();
    expect(branchedOn2a.branchTipCount).toBe(2);
    expect(branchedOn2a.totalHiddenSwipes).toBe(2); // t2b and t2c remain hidden
  });

  it("preserves distinct-prompt 1-turn alternate branches, models __arrival__ as waypoints, and computes uniqueDescendantTipId", () => {
    const t0 = makeTurn({ id: "t0", parentId: null, depth: 0 });
    const t1 = makeTurn({ id: "t1", parentId: "t0", depth: 1, userMessage: "Talk to Kira." });
    const arr = makeTurn({
      id: "arr-1",
      parentId: "t1",
      depth: 2,
      actorId: "__arrival__",
      userMessage: "",
      locationId: LOC_ALLEY.id,
    });
    const t2a = makeTurn({ id: "t2a", parentId: "arr-1", depth: 3, userMessage: "Inspect the alley." });

    // Distinct-prompt 1-turn alternate branch off t1 (should stay visible even with 0 children!)
    const t2bSolo = makeTurn({ id: "t2b-solo", parentId: "t1", depth: 2, userMessage: "Draw my blaster instead." });

    // Split alternate branch off t1: altMid -> altTip1 & altTip2
    const altMid = makeTurn({ id: "alt-mid", parentId: "t1", depth: 2, userMessage: "Bribe the bouncer." });
    const altTip1 = makeTurn({ id: "alt-tip-1", parentId: "alt-mid", depth: 3, userMessage: "Slip past quietly." });
    const altTip2 = makeTurn({ id: "alt-tip-2", parentId: "alt-mid", depth: 3, userMessage: "Cause a distraction." });

    // Single-tip alternate interior branch off t0: altRoot -> altLeaf
    const altSingleMid = makeTurn({ id: "alt-single-mid", parentId: "t0", depth: 1, userMessage: "Leave immediately." });
    const altSingleTip = makeTurn({ id: "alt-single-tip", parentId: "alt-single-mid", depth: 2, userMessage: "Catch the maglev." });

    const allTurns = [t0, t1, arr, t2a, t2bSolo, altMid, altTip1, altTip2, altSingleMid, altSingleTip];
    const model = buildBranchGraphModel({
      allTurns,
      activeBranchTurns: [t0, t1, arr, t2a],
      activeLeafId: "t2a",
      locationNamesById: { [LOC_BAR.id]: LOC_BAR.name, [LOC_ALLEY.id]: LOC_ALLEY.name },
    });

    // Waypoint node preserves lineage cleanly
    expect(model.nodeById["arr-1"].kind).toBe("waypoint");
    expect(model.nodeById["arr-1"].locationName).toBe("Cargo Alley");

    // Distinct-prompt 1-turn alternate branch is NOT hidden
    expect(model.nodeById["t2b-solo"]).toBeDefined();
    expect(model.nodeById["t2b-solo"].isBranchTip).toBe(true);
    expect(model.nodeById["t2b-solo"].uniqueDescendantTipId).toBe("t2b-solo");

    // Active branch nodes never expose uniqueDescendantTipId
    expect(model.nodeById["t1"].uniqueDescendantTipId).toBeNull();
    expect(model.nodeById["t2a"].uniqueDescendantTipId).toBeNull();

    // Split alternate interior node (2 tips) has uniqueDescendantTipId === null
    expect(model.nodeById["alt-mid"].isBranchTip).toBe(false);
    expect(model.nodeById["alt-mid"].uniqueDescendantTipId).toBeNull();
    expect(model.nodeById["alt-tip-1"].uniqueDescendantTipId).toBe("alt-tip-1");
    expect(model.nodeById["alt-tip-2"].uniqueDescendantTipId).toBe("alt-tip-2");

    // Unsplit alternate interior node (1 unique tip) resolves directly to that tip
    expect(model.nodeById["alt-single-mid"].isBranchTip).toBe(false);
    expect(model.nodeById["alt-single-mid"].uniqueDescendantTipId).toBe("alt-single-tip");

    // Ancestor path highlighting from Turn 0 -> alt-tip-2
    const path = computeAncestorPath(model.nodeById, "alt-tip-2");
    expect(Array.from(path.nodeIds)).toEqual(["alt-tip-2", "alt-mid", "t1", "t0"]);
    expect(path.edgeIds.has("t0->t1")).toBe(true);
    expect(path.edgeIds.has("t1->alt-mid")).toBe(true);
    expect(path.edgeIds.has("alt-mid->alt-tip-2")).toBe(true);

    // Viewport math returns finite transforms
    const fit = computeFitGraphViewport(model.bounds, 900, 460);
    expect(Number.isFinite(fit.zoom)).toBe(true);
    expect(Number.isFinite(fit.pan.x)).toBe(true);
    expect(Number.isFinite(fit.pan.y)).toBe(true);

    const centered = computeCenterNodeViewport(model.nodeById["t2a"], 900, 460, 0.9);
    expect(centered.zoom).toBe(0.9);
    expect(Number.isFinite(centered.pan.x)).toBe(true);
  });
});

describe("Story Modal, Branch Buttons, Sidebar & Inspector UI (SSR markup)", () => {
  it("renders Story button between Codex and Party in AppSidebar (expanded + rail) and removes Story & Timeline Branches from LiveInspector", () => {
    const t0 = makeTurn({ id: "t0", parentId: null, depth: 0 });
    const t1 = makeTurn({ id: "t1", parentId: "t0", depth: 1 });
    const bundle = makeBundle([t0, t1], [t0, t1]);
    const noop = vi.fn();

    const expandedSidebar = renderToStaticMarkup(
      <AppSidebar
        mode="expanded"
        bundle={bundle}
        worldName={WORLD.name}
        codexCount={2}
        storyCount={3}
        hasStoryAttention
        isStoryOpen={false}
        onOpenCodex={noop}
        onOpenStory={noop}
        onOpenParty={noop}
        notes={[]}
        showNotesFlyout={false}
        setShowNotesFlyout={noop}
        currentUser={USER}
        singleUserMode
        setNotesModalInitialId={noop}
        setShowNotesModal={noop}
        setProfileInitialTab={noop}
        setShowProfileModal={noop}
        setAdminInitialTab={noop}
        setShowAdminModal={noop}
        handleCloseCampaign={noop}
        handleLogout={async () => {}}
      />
    );
    expect(expandedSidebar.indexOf("Codex")).toBeLessThan(expandedSidebar.indexOf("Story"));
    expect(expandedSidebar.indexOf("Story")).toBeLessThan(expandedSidebar.indexOf("Party"));
    expect(expandedSidebar).toContain("sidebar-story-attention-dot");

    const railSidebar = renderToStaticMarkup(
      <AppSidebar
        mode="rail"
        bundle={bundle}
        onOpenCodex={noop}
        onOpenStory={noop}
        onOpenParty={noop}
        hasStoryAttention
        notes={[]}
        showNotesFlyout={false}
        setShowNotesFlyout={noop}
        currentUser={USER}
        singleUserMode
        setNotesModalInitialId={noop}
        setShowNotesModal={noop}
        setProfileInitialTab={noop}
        setShowProfileModal={noop}
        setAdminInitialTab={noop}
        setShowAdminModal={noop}
        handleCloseCampaign={noop}
        handleLogout={async () => {}}
      />
    );
    expect(railSidebar.indexOf("Open Campaign Codex")).toBeLessThan(
      railSidebar.indexOf("Open Campaign Story &amp; Timelines")
    );
    expect(railSidebar.indexOf("Open Campaign Story &amp; Timelines")).toBeLessThan(
      railSidebar.indexOf("Manage Parties")
    );

    const inspectorHtml = renderToStaticMarkup(
      <LiveInspector
        mode="expanded"
        bundle={bundle}
        world={WORLD}
        character={CHAR_KIRA}
      />
    );
    expect(inspectorHtml).toContain("World Clock");
    expect(inspectorHtml).toContain("Internals");
    expect(inspectorHtml).not.toContain("Timeline Branches");
    expect(inspectorHtml).not.toContain("No summaries yet.");
  });

  it("renders Branch on Turn #0 and interior turns (not leaf or Turn #0 alone), disables Delete when turn has descendants, and omits Branch on StandaloneArrivalCard", () => {
    const t0 = makeTurn({ id: "t0", parentId: null, depth: 0 });
    const t1 = makeTurn({ id: "t1", parentId: "t0", depth: 1 });
    const t2 = makeTurn({ id: "t2", parentId: "t1", depth: 2 });
    const noop = vi.fn();

    // Turn #0 alone -> no Branch button
    const soloRootBundle = makeBundle([t0], [t0]);
    const soloRootHtml = renderToStaticMarkup(
      <TurnCard
        turn={t0}
        turnIdx={0}
        bundle={soloRootBundle}
        character={CHAR_KIRA}
        allCampaignCharacters={[CHAR_KIRA]}
        presentCharacterIds={[CHAR_KIRA.id]}
        siblings={[t0]}
        isBusy={false}
        isDeletingTurn={false}
        isEditingThisTurn={false}
        hasActiveEditingTurn={false}
        hasDeleteLastHandler
        hasDescendants={false}
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
      />
    );
    expect(soloRootHtml).toContain('data-turn-id="t0"');
    expect(soloRootHtml).not.toContain("Branch from here");

    // Turn #0 when on Turn #1 -> shows Branch button!
    const twoTurnBundle = makeBundle([t0, t1], [t0, t1]);
    const rootWithChildHtml = renderToStaticMarkup(
      <TurnCard
        turn={t0}
        turnIdx={0}
        bundle={twoTurnBundle}
        character={CHAR_KIRA}
        allCampaignCharacters={[CHAR_KIRA]}
        presentCharacterIds={[CHAR_KIRA.id]}
        siblings={[t0]}
        isBusy={false}
        isDeletingTurn={false}
        isEditingThisTurn={false}
        hasActiveEditingTurn={false}
        hasDeleteLastHandler
        hasDescendants
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
      />
    );
    expect(rootWithChildHtml).toContain("Branch from here");

    // Rewound interior leaf (t1 is active leaf, t2 still exists as child) -> no Branch, Delete disabled, ChatStage shows rewind banner
    const rewoundBundle = makeBundle([t0, t1, t2], [t0, t1]);
    const rewoundStageHtml = renderToStaticMarkup(
      <ChatStage
        bundle={rewoundBundle}
        character={CHAR_KIRA}
        isStreaming={false}
        liveStream={null}
        onSendTurn={noop}
        onCheckoutTurn={noop}
        onDeleteLastTurn={noop}
        onOpenStoryTimelines={noop}
      />
    );
    expect(rewoundStageHtml).toContain("Cannot delete a turn that has descendant branches");
    expect(rewoundStageHtml).toContain("Branched at Turn #1");
    expect(rewoundStageHtml).toContain("Open Branch Graph");

    // StandaloneArrivalCard emits data-turn-id for map moves and has no Branch button
    const arrivalHtml = renderToStaticMarkup(
      <StandaloneArrivalCard
        turnId="arr-1"
        lastTurnId="t2"
        worldTimestamp="Day 1 20:10"
        source="map"
        turnDepthIndex={2}
        cards={[
          {
            entity_type: "location",
            entity_id: LOC_ALLEY.id,
            depth: 0,
            title: LOC_ALLEY.name,
            description: LOC_ALLEY.description,
          },
        ]}
        manualOverrides={{}}
        onToggleCard={noop}
      />
    );
    expect(arrivalHtml).toContain('data-turn-id="arr-1"');
    expect(arrivalHtml).not.toContain("Branch from here");
  });

  it("renders StoryModal Summary and Timelines (Branch Graph) with scoped Zoom to moment and Switch to this timeline actions", () => {
    const t0 = makeTurn({ id: "t0", parentId: null, depth: 0 });
    const t1 = makeTurn({
      id: "t1",
      parentId: "t0",
      depth: 1,
      userMessage: "Talk to Kira.",
      notableSummary: "Kira accepts the job",
    });
    const t2a = makeTurn({ id: "t2a", parentId: "t1", depth: 2, userMessage: "Go north." });
    const t2aSwipe = makeTurn({ id: "t2a-s", parentId: "t1", depth: 2, userMessage: "Go north." });
    const t3a = makeTurn({ id: "t3a", parentId: "t2a", depth: 3, userMessage: "Open the gate." });

    // Alternate split branch: altMid -> altTip1, altTip2
    const altMid = makeTurn({ id: "alt-mid", parentId: "t1", depth: 2, userMessage: "Go south." });
    const altTip1 = makeTurn({ id: "alt-tip-1", parentId: "alt-mid", depth: 3, userMessage: "Hide." });
    const altTip2 = makeTurn({ id: "alt-tip-2", parentId: "alt-mid", depth: 3, userMessage: "Fight." });

    const chunk: EpisodicChunkRecord = {
      id: "chunk-1",
      campaign_id: "camp-1",
      start_turn_depth: 1,
      end_turn_depth: 3,
      leaf_turn_id: "t3a",
      summary_text: "Kira accepted the job and opened the northern gate.",
      created_at: "2026-01-01T00:10:00Z",
    };

    const bundle = makeBundle([t0, t1, t2a, t2aSwipe, t3a, altMid, altTip1, altTip2], [t0, t1, t2a, t3a], [chunk]);
    const noop = vi.fn();

    // 1. Summary tab
    const summaryHtml = renderToStaticMarkup(
      <StoryModal
        isOpen
        initialTab="summary"
        onClose={noop}
        bundle={bundle}
        onZoomToTurn={noop}
        onSwitchTimeline={noop}
        onBranchFromTurn={noop}
      />
    );
    expect(summaryHtml).toContain("Summary");
    expect(summaryHtml).toContain("Timelines");
    expect(summaryHtml).toContain("Turns 1–3");
    expect(summaryHtml).toContain("Kira accepted the job and opened the northern gate.");

    // 2. Timelines tab with active-branch interior node selected (t1): Zoom to moment + Branch from here, NO Switch to this timeline
    const activeSelHtml = renderToStaticMarkup(
      <StoryModal
        isOpen
        initialTab="timelines"
        initialSelectedNodeId="t1"
        onClose={noop}
        bundle={bundle}
        onZoomToTurn={noop}
        onSwitchTimeline={noop}
        onBranchFromTurn={noop}
      />
    );
    expect(activeSelHtml).toContain("Branch Graph");
    expect(activeSelHtml).toContain("Kira accepts the job");
    expect(activeSelHtml).toContain("+1 swipe");
    expect(activeSelHtml).toContain("Zoom to moment");
    expect(activeSelHtml).toContain("Branch from here");
    expect(activeSelHtml).not.toContain("Switch to this timeline");

    // 3. Timelines tab with alternate branch tip selected (alt-tip-1): Switch to this timeline, NO Zoom to moment
    const altTipHtml = renderToStaticMarkup(
      <StoryModal
        isOpen
        initialTab="timelines"
        initialSelectedNodeId="alt-tip-1"
        onClose={noop}
        bundle={bundle}
        onZoomToTurn={noop}
        onSwitchTimeline={noop}
        onBranchFromTurn={noop}
      />
    );
    expect(altTipHtml).toContain("Switch to this timeline");
    expect(altTipHtml).not.toContain("Zoom to moment");
    expect(altTipHtml).not.toContain("Branch from here");

    // 4. Timelines tab with split alternate interior node selected (alt-mid): Branch from here ONLY (no Zoom, no ambiguous Switch)
    const altSplitHtml = renderToStaticMarkup(
      <StoryModal
        isOpen
        initialTab="timelines"
        initialSelectedNodeId="alt-mid"
        onClose={noop}
        bundle={bundle}
        onZoomToTurn={noop}
        onSwitchTimeline={noop}
        onBranchFromTurn={noop}
      />
    );
    expect(altSplitHtml).toContain("Branch from here");
    expect(altSplitHtml).not.toContain("Zoom to moment");
    expect(altSplitHtml).not.toContain("Switch to this timeline");
  });
});
