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
import { BranchGraphCanvas } from "../story/BranchGraphCanvas";
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

describe("Branch Graph Summarized Episode Grouping (v0.28.1)", () => {
  it("groups only summarized episode turns (absorbing interior __arrival__ waypoints) and keeps Turn #0 + unsummarized turns visible", () => {
    const t0 = makeTurn({ id: "t0", parentId: null, depth: 0 });
    const t1 = makeTurn({ id: "t1", parentId: "t0", depth: 1, userMessage: "Enter bar." });
    const t2Arr = makeTurn({
      id: "t2",
      parentId: "t1",
      depth: 2,
      actorId: "__arrival__",
      locationId: LOC_ALLEY.id,
      userMessage: "",
    });
    const t3 = makeTurn({ id: "t3", parentId: "t2", depth: 3, userMessage: "Meet fixer." });
    const t4 = makeTurn({ id: "t4", parentId: "t3", depth: 4, userMessage: "Seal deal." });
    const t5 = makeTurn({ id: "t5", parentId: "t4", depth: 5, userMessage: "Walk away." });
    const t6 = makeTurn({ id: "t6", parentId: "t5", depth: 6, userMessage: "Check datapad." });

    const chunk: EpisodicChunkRecord = {
      id: "ep-1",
      campaign_id: "camp-1",
      start_turn_depth: 1,
      end_turn_depth: 4,
      leaf_turn_id: "t6",
      title: "The Alley Deal",
      synopsis_text: "Met the fixer in Cargo Alley and sealed the contract.",
      summary_text: "Entered the bar, moved to Cargo Alley, met the fixer, and sealed the deal.",
      created_at: "2026-01-01T00:10:00Z",
    };

    const allTurns = [t0, t1, t2Arr, t3, t4, t5, t6];
    const model = buildBranchGraphModel({
      allTurns,
      activeBranchTurns: allTurns,
      activeLeafId: "t6",
      episodicChunks: [chunk],
      allEpisodicChunks: [chunk],
      locationNamesById: { [LOC_BAR.id]: LOC_BAR.name, [LOC_ALLEY.id]: LOC_ALLEY.name },
    });

    // t0, episode:ep-1 (absorbing t1, t2 waypoint, t3, t4), t5, t6
    expect(model.nodes.map((n) => n.id)).toEqual(["t0", "episode:ep-1", "t5", "t6"]);
    expect(model.totalTurnCount).toBe(7);
    expect(model.collapsedEpisodeCount).toBe(1);
    expect(model.branchTipCount).toBe(1);
    expect(model.defaultExpandedEpisodeIds).toEqual([]);

    const epNode = model.nodeById["episode:ep-1"];
    expect(epNode.kind).toBe("episode");
    expect(epNode.isActiveBranch).toBe(true);
    expect(epNode.episodeGroup?.turnIds).toEqual(["t1", "t2", "t3", "t4"]);
    expect(epNode.episodeGroup?.narrativeTurnCount).toBe(3);
    expect(epNode.episodeGroup?.waypointCount).toBe(1);
    expect(epNode.episodeGroup?.summaryVariants[0].kind).toBe("active");
    expect(epNode.episodeGroup?.summaryVariants[0].title).toBe("The Alley Deal");

    // Ancestor path from t6 walks smoothly through collapsed pseudo-node back to t0
    const path = computeAncestorPath(model.nodeById, "t6");
    expect([...path.nodeIds]).toEqual(["t6", "t5", "episode:ep-1", "t0"]);
    expect(model.edges.find((e) => e.id === "episode:ep-1->t5")?.isActiveBranch).toBe(true);
  });

  it("re-parents single and multiple interior branches onto collapsed pseudo-node with origin depths and re-anchors on expand", () => {
    const t0 = makeTurn({ id: "t0", parentId: null, depth: 0 });
    const t1 = makeTurn({ id: "t1", parentId: "t0", depth: 1 });
    const t2 = makeTurn({ id: "t2", parentId: "t1", depth: 2 });
    const t3 = makeTurn({ id: "t3", parentId: "t2", depth: 3 });
    const t4 = makeTurn({ id: "t4", parentId: "t3", depth: 4 });
    const t5 = makeTurn({ id: "t5", parentId: "t4", depth: 5 });

    // Branch B originates at t2; Branch C originates at t3
    const b3 = makeTurn({ id: "b3", parentId: "t2", depth: 3, userMessage: "Branch B action" });
    const c4 = makeTurn({ id: "c4", parentId: "t3", depth: 4, userMessage: "Branch C action" });

    const chunk: EpisodicChunkRecord = {
      id: "ep-trunk",
      campaign_id: "camp-1",
      start_turn_depth: 1,
      end_turn_depth: 4,
      leaf_turn_id: "t5",
      title: "Trunk Episode",
      synopsis_text: "Main spine turns 1 to 4.",
      summary_text: "Main spine summary.",
      created_at: "2026-01-01T00:10:00Z",
    };

    const allTurns = [t0, t1, t2, t3, t4, t5, b3, c4];
    const activeBranch = [t0, t1, t2, t3, t4, t5];

    // Collapsed view: t5, b3, c4 all originate from episode:ep-trunk with exact originTurnDepth
    const collapsed = buildBranchGraphModel({
      allTurns,
      activeBranchTurns: activeBranch,
      activeLeafId: "t5",
      episodicChunks: [chunk],
      allEpisodicChunks: [chunk],
    });
    expect(collapsed.branchTipCount).toBe(3);
    expect(collapsed.edges.find((e) => e.toId === "t5")).toMatchObject({
      fromId: "episode:ep-trunk",
      originTurnDepth: 4,
    });
    expect(collapsed.edges.find((e) => e.toId === "b3")).toMatchObject({
      fromId: "episode:ep-trunk",
      originTurnDepth: 2,
    });
    expect(collapsed.edges.find((e) => e.toId === "c4")).toMatchObject({
      fromId: "episode:ep-trunk",
      originTurnDepth: 3,
    });

    // Expanded view: each branch re-anchors to its exact branching turn
    const expanded = buildBranchGraphModel({
      allTurns,
      activeBranchTurns: activeBranch,
      activeLeafId: "t5",
      episodicChunks: [chunk],
      allEpisodicChunks: [chunk],
      expandedEpisodeIds: new Set(["episode:ep-trunk"]),
    });
    expect(expanded.branchTipCount).toBe(3);
    expect(expanded.edges.find((e) => e.toId === "t5")?.fromId).toBe("t4");
    expect(expanded.edges.find((e) => e.toId === "b3")?.fromId).toBe("t2");
    expect(expanded.edges.find((e) => e.toId === "c4")?.fromId).toBe("t3");
    expect(expanded.expandedEpisodeFrames).toHaveLength(1);
    expect(expanded.nodeById["t2"].memberEpisodeId).toBe("episode:ep-trunk");
  });

  it("shows Episode in Progress with alternate summary switcher when active timeline has not summarized yet and does not swallow short divergent turns", () => {
    const t0 = makeTurn({ id: "t0", parentId: null, depth: 0 });
    const t1 = makeTurn({ id: "t1", parentId: "t0", depth: 1 });
    const t2 = makeTurn({ id: "t2", parentId: "t1", depth: 2 });
    const t3a = makeTurn({ id: "t3a", parentId: "t2", depth: 3, userMessage: "Go left." });
    const t4a = makeTurn({ id: "t4a", parentId: "t3a", depth: 4, userMessage: "Open vault." });
    const t5a = makeTurn({ id: "t5a", parentId: "t4a", depth: 5, userMessage: "Grab chip." });

    // Short active timeline B branched at t2 -> t3b -> t4b (has NOT summarized yet)
    const t3b = makeTurn({ id: "t3b", parentId: "t2", depth: 3, userMessage: "Go right." });
    const t4b = makeTurn({ id: "t4b", parentId: "t3b", depth: 4, userMessage: "Climb roof." });

    const chunkA: EpisodicChunkRecord = {
      id: "ep-a",
      campaign_id: "camp-1",
      start_turn_depth: 1,
      end_turn_depth: 4,
      leaf_turn_id: "t5a",
      title: "Vault Heist",
      synopsis_text: "Broke into the left-wing vault.",
      summary_text: "Timeline A stole the chip from the vault.",
      created_at: "2026-01-01T00:10:00Z",
    };

    const allTurns = [t0, t1, t2, t3a, t4a, t5a, t3b, t4b];
    const activeBranch = [t0, t1, t2, t3b, t4b];

    const model = buildBranchGraphModel({
      allTurns,
      activeBranchTurns: activeBranch,
      activeLeafId: "t4b",
      episodicChunks: [],
      allEpisodicChunks: [chunkA],
    });

    // t3b and t4b are NOT swallowed into episode:ep-a even though their depth <= 4!
    expect(model.nodes.map((n) => n.id)).toEqual(["t0", "episode:ep-a", "t3b", "t4b", "t5a"]);
    const ep = model.episodeById["episode:ep-a"];
    expect(ep.turnIds).toEqual(["t1", "t2", "t3a", "t4a"]);
    expect(ep.isInProgressOnActive).toBe(true);
    expect(ep.summaryVariants).toHaveLength(2);
    expect(ep.summaryVariants[0]).toMatchObject({
      kind: "in_progress",
      title: "Episode in Progress",
    });
    expect(ep.summaryVariants[1]).toMatchObject({
      kind: "alternate",
      chunkId: "ep-a",
      title: "Vault Heist",
    });
    // t3b branches from t2 inside episode:ep-a; t5a continues from t4a
    expect(model.edges.find((e) => e.toId === "t3b")).toMatchObject({
      fromId: "episode:ep-a",
      originTurnDepth: 2,
      isActiveBranch: true,
    });
  });

  it("enforces active-first disjoint ownership when two divergent timelines both summarize overlapping trunk turns", () => {
    const t0 = makeTurn({ id: "t0", parentId: null, depth: 0 });
    const t1 = makeTurn({ id: "t1", parentId: "t0", depth: 1 });
    const t2 = makeTurn({ id: "t2", parentId: "t1", depth: 2 });
    const t3a = makeTurn({ id: "t3a", parentId: "t2", depth: 3, userMessage: "Path A3" });
    const t4a = makeTurn({ id: "t4a", parentId: "t3a", depth: 4, userMessage: "Path A4" });
    const t5a = makeTurn({ id: "t5a", parentId: "t4a", depth: 5, userMessage: "Path A5" });
    const t3b = makeTurn({ id: "t3b", parentId: "t2", depth: 3, userMessage: "Path B3" });
    const t4b = makeTurn({ id: "t4b", parentId: "t3b", depth: 4, userMessage: "Path B4" });
    const t5b = makeTurn({ id: "t5b", parentId: "t4b", depth: 5, userMessage: "Path B5" });

    const chunkA: EpisodicChunkRecord = {
      id: "ep-a",
      campaign_id: "camp-1",
      start_turn_depth: 1,
      end_turn_depth: 4,
      leaf_turn_id: "t5a",
      title: "Active Trunk",
      synopsis_text: "Active A summary.",
      summary_text: "Active A full summary.",
      created_at: "2026-01-01T00:10:00Z",
    };
    const chunkB: EpisodicChunkRecord = {
      id: "ep-b",
      campaign_id: "camp-1",
      start_turn_depth: 1,
      end_turn_depth: 4,
      leaf_turn_id: "t5b",
      title: "Alternate Path B",
      synopsis_text: "Alternate B summary.",
      summary_text: "Alternate B full summary.",
      created_at: "2026-01-01T00:11:00Z",
    };

    const allTurns = [t0, t1, t2, t3a, t4a, t5a, t3b, t4b, t5b];
    const activeBranch = [t0, t1, t2, t3a, t4a, t5a];

    const model = buildBranchGraphModel({
      allTurns,
      activeBranchTurns: activeBranch,
      activeLeafId: "t5a",
      episodicChunks: [chunkA],
      allEpisodicChunks: [chunkA, chunkB],
    });

    // Active chunk A owns shared trunk t1..t2 + t3a..t4a; alternate chunk B owns only unclaimed post-divergence t3b..t4b
    const epA = model.episodeById["episode:ep-a"];
    const epB = model.episodeById["episode:ep-b"];
    expect(epA.turnIds).toEqual(["t1", "t2", "t3a", "t4a"]);
    expect(epB.turnIds).toEqual(["t3b", "t4b"]);
    // Overlapping chunk B is also registered as an alternate summary variant on epA
    expect(epA.summaryVariants.map((v) => v.chunkId)).toEqual(["ep-a", "ep-b"]);
    // Purely off-branch epB displays its own alternate summary directly
    expect(epB.isInProgressOnActive).toBe(false);
    expect(epB.summaryVariants[0]).toMatchObject({ kind: "alternate", title: "Alternate Path B" });
    expect(model.edges.find((e) => e.toId === "episode:ep-b")).toMatchObject({
      fromId: "episode:ep-a",
      originTurnDepth: 2,
    });
  });

  it("auto-expands an episode when activeLeafId is inside it and auto-expands episodes with hidden swipes when showAllSwipes is enabled", () => {
    const t0 = makeTurn({ id: "t0", parentId: null, depth: 0 });
    const t1 = makeTurn({ id: "t1", parentId: "t0", depth: 1, userMessage: "Ask Kira." });
    const t2 = makeTurn({ id: "t2", parentId: "t1", depth: 2, userMessage: "Inspect badge." });
    const t2Swipe = makeTurn({ id: "t2-s", parentId: "t1", depth: 2, userMessage: "Inspect badge." });
    const t3 = makeTurn({ id: "t3", parentId: "t2", depth: 3, userMessage: "Follow Kira." });
    const t4 = makeTurn({ id: "t4", parentId: "t3", depth: 4, userMessage: "Leave bar." });

    const chunk: EpisodicChunkRecord = {
      id: "ep-1",
      campaign_id: "camp-1",
      start_turn_depth: 1,
      end_turn_depth: 3,
      leaf_turn_id: "t4",
      title: "Badge Check",
      synopsis_text: "Inspected Kira's badge.",
      summary_text: "Full summary.",
      created_at: "2026-01-01T00:10:00Z",
    };

    const allTurns = [t0, t1, t2, t2Swipe, t3, t4];

    // 1. Active leaf is t2 (inside ep-1) -> auto-expanded by default!
    const rewoundModel = buildBranchGraphModel({
      allTurns,
      activeBranchTurns: [t0, t1, t2],
      activeLeafId: "t2",
      episodicChunks: [],
      allEpisodicChunks: [chunk],
    });
    expect(rewoundModel.defaultExpandedEpisodeIds).toEqual(["episode:ep-1"]);
    expect(rewoundModel.collapsedEpisodeCount).toBe(0);
    expect(rewoundModel.nodeById["t2"].isActiveLeaf).toBe(true);

    // 2. Active leaf is t4 (outside ep-1) -> collapsed by default, hides swipe count inside ep-1
    const collapsedModel = buildBranchGraphModel({
      allTurns,
      activeBranchTurns: [t0, t1, t2, t3, t4],
      activeLeafId: "t4",
      episodicChunks: [chunk],
      allEpisodicChunks: [chunk],
    });
    expect(collapsedModel.collapsedEpisodeCount).toBe(1);
    expect(collapsedModel.episodeById["episode:ep-1"].hiddenSwipeCount).toBe(1);

    // 3. Turning showAllSwipes ON auto-expands ep-1 so the hidden swipe becomes visible
    const swipeShownModel = buildBranchGraphModel({
      allTurns,
      activeBranchTurns: [t0, t1, t2, t3, t4],
      activeLeafId: "t4",
      episodicChunks: [chunk],
      allEpisodicChunks: [chunk],
      showAllSwipes: true,
    });
    expect(swipeShownModel.collapsedEpisodeCount).toBe(0);
    expect(swipeShownModel.nodeById["t2-s"].isExpandedSwipe).toBe(true);
  });

  it("renders collapsed Summary Pseudo-Nodes with +N turns expand pill, Episode in Progress, chevron switcher, and origin edge labels in BranchGraphCanvas", () => {
    const t0 = makeTurn({ id: "t0", parentId: null, depth: 0 });
    const t1 = makeTurn({ id: "t1", parentId: "t0", depth: 1 });
    const t2 = makeTurn({ id: "t2", parentId: "t1", depth: 2 });
    const t3a = makeTurn({ id: "t3a", parentId: "t2", depth: 3, userMessage: "Left door." });
    const t4a = makeTurn({ id: "t4a", parentId: "t3a", depth: 4, userMessage: "Continue left." });
    const t3b = makeTurn({ id: "t3b", parentId: "t2", depth: 3, userMessage: "Right door." });

    const chunkA: EpisodicChunkRecord = {
      id: "ep-a",
      campaign_id: "camp-1",
      start_turn_depth: 1,
      end_turn_depth: 3,
      leaf_turn_id: "t4a",
      title: "Left Corridor",
      synopsis_text: "Explored the left corridor.",
      summary_text: "Explored the left corridor in Timeline A.",
      created_at: "2026-01-01T00:10:00Z",
    };

    const bundle = makeBundle([t0, t1, t2, t3a, t4a, t3b], [t0, t1, t2, t3b], []);
    bundle.all_episodic_chunks = [chunkA];
    const noop = vi.fn();

    const html = renderToStaticMarkup(
      <BranchGraphCanvas
        bundle={bundle}
        initialSelectedNodeId="episode:ep-a"
        onZoomToTurn={noop}
        onSwitchTimeline={noop}
        onBranchFromTurn={noop}
      />
    );

    expect(html).toContain('data-graph-node-kind="episode"');
    expect(html).toContain('data-episode-expand-id="episode:ep-a"');
    expect(html).toContain('data-episode-variant-switcher="episode:ep-a"');
    expect(html).toContain("+3 turns");
    expect(html).toContain("Episode in Progress");
    expect(html).toContain("View alternate timeline summary");
    expect(html).toContain("from #2");
    expect(html).toContain("Expand 3 turns");
  });
});
